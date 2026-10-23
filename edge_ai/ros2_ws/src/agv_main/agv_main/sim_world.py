"""シミュレーター（ROS に依存しない部分）: 地図の中を走る仮想の TT-02、仮想の ESP32、仮想の LiDAR。

Gazebo を使わずに、Nav2 → serial_bridge と同じ判断部（RobotCore）→ 仮想 ESP32 → 車の動き、を通しで試せる。
実機と同じくらいの癖（速度の誤差・ジャイロのずれ・LiDAR のノイズ・ESC の遅れ）を少し入れてある。
"""
from __future__ import annotations

import logging
import math
import threading
import time
from pathlib import Path

import numpy as np
import yaml

from . import protocol

log = logging.getLogger("sim")


def read_pgm(path: str | Path) -> np.ndarray:
    """PGM（P5 / P2）画像を読む（OpenCV や Pillow を使わない）。"""
    data = Path(path).read_bytes()
    tokens: list[bytes] = []
    i = 0
    while len(tokens) < 4:
        while i < len(data) and data[i:i + 1].isspace():
            i += 1
        if data[i:i + 1] == b"#":
            while i < len(data) and data[i:i + 1] not in (b"\n", b"\r"):
                i += 1
            continue
        j = i
        while j < len(data) and not data[j:j + 1].isspace():
            j += 1
        tokens.append(data[i:j])
        i = j
    magic, w, h, maxval = tokens[0], int(tokens[1]), int(tokens[2]), int(tokens[3])
    if magic == b"P5":
        i += 1  # ヘッダの後の空白1文字
        dtype = np.uint8 if maxval < 256 else np.dtype(">u2")
        img = np.frombuffer(data, dtype=dtype, count=w * h, offset=i).reshape(h, w)
    elif magic == b"P2":
        img = np.array(data[i:].split()[: w * h], dtype=np.int32).reshape(h, w)
    else:
        raise ValueError(f"PGM ではありません: {path}")
    if maxval != 255:
        img = (img.astype(np.float64) * 255.0 / maxval).astype(np.uint8)
    return img.astype(np.uint8)


class SimMap:
    """map_server と同じ解釈で地図を読む（yaml の occupied_thresh / negate に従う）。"""

    def __init__(self, yaml_path: str | Path):
        p = Path(yaml_path)
        meta = yaml.safe_load(p.read_text(encoding="utf-8"))
        self.res = float(meta["resolution"])
        self.ox, self.oy = float(meta["origin"][0]), float(meta["origin"][1])
        img = read_pgm(p.parent / meta["image"]).astype(np.float32) / 255.0
        occ_p = img if int(meta.get("negate", 0)) else 1.0 - img
        self.occ = occ_p > float(meta.get("occupied_thresh", 0.65))
        self.h, self.w = self.occ.shape

    def cell(self, x, y):
        c = np.floor((np.asarray(x) - self.ox) / self.res).astype(int)
        r = (self.h - 1) - np.floor((np.asarray(y) - self.oy) / self.res).astype(int)
        return r, c

    def occupied(self, x, y):
        r, c = self.cell(x, y)
        inb = (r >= 0) & (r < self.h) & (c >= 0) & (c < self.w)
        out = np.ones(np.shape(r), dtype=bool)
        out[inb] = self.occ[r[inb], c[inb]]
        return out


class SimWorld:
    """車の動き（自転車モデル）と、LiDAR のレーザー計算。(x, y) は車体の中心。"""

    def __init__(self, map_yaml: str, start=(-4.0, -4.0, 0.0), obstacles=None,
                 wheelbase=0.257, max_steer_deg=25.0, length=0.42, width=0.19,
                 true_gain=2.2, deadband=0.07, gyro_drift_dps=0.05, seed=1):
        self.map = SimMap(map_yaml)
        self.x, self.y, self.th = float(start[0]), float(start[1]), math.radians(float(start[2]))
        self.v = 0.0
        self.delta = 0.0
        self.L = wheelbase
        self.max_steer = math.radians(max_steer_deg)
        self.length, self.width = length, width
        self.true_gain, self.deadband = true_gain, deadband
        self.obstacles = list(obstacles or [])     # [(x, y, 半径)]
        self.gyro_bias = math.radians(gyro_drift_dps)
        self.yaw_meas = 0.0
        self.cmd_steer = 0.0
        self.cmd_thr = 0.0
        self.collided = False
        self.collisions = 0
        self.rng = np.random.default_rng(seed)
        self.lock = threading.Lock()

    def set_command(self, steer: float, thr: float) -> None:
        with self.lock:
            self.cmd_steer, self.cmd_thr = steer, thr

    def pose(self) -> tuple[float, float, float]:
        with self.lock:
            return self.x, self.y, self.th

    def _footprint(self, x, y, th):
        xs = np.linspace(-self.length / 2, self.length / 2, 7)
        ys = np.linspace(-self.width / 2, self.width / 2, 4)
        gx, gy = np.meshgrid(xs, ys)
        gx, gy = gx.ravel(), gy.ravel()
        c, s = math.cos(th), math.sin(th)
        return x + c * gx - s * gy, y + s * gx + c * gy

    def _hits(self, x, y, th) -> bool:
        fx, fy = self._footprint(x, y, th)
        if self.map.occupied(fx, fy).any():
            return True
        for (ox, oy, r) in self.obstacles:
            if np.any((fx - ox) ** 2 + (fy - oy) ** 2 < r * r):
                return True
        return False

    def step(self, dt: float) -> None:
        with self.lock:
            a = abs(self.cmd_thr)
            vt = 0.0 if a <= self.deadband else math.copysign(self.true_gain * (a - self.deadband), self.cmd_thr)
            self.v += (vt - self.v) * min(1.0, dt / 0.25)
            self.delta += (self.cmd_steer * self.max_steer - self.delta) * min(1.0, dt / 0.12)
            v = self.v * (1.0 + self.rng.normal(0, 0.03))
            nth = self.th + v * math.tan(self.delta) / self.L * dt
            nx = self.x + v * math.cos(self.th) * dt
            ny = self.y + v * math.sin(self.th) * dt
            if self._hits(nx, ny, nth):
                if not self.collided:
                    self.collisions += 1
                    log.warning("シミュレーター: 衝突しました at (%.2f, %.2f)", nx, ny)
                self.collided = True
                self.v = 0.0
                return
            self.collided = False
            dth = nth - self.th
            self.x, self.y, self.th = nx, ny, nth
            self.yaw_meas += dth + self.gyro_bias * dt + self.rng.normal(0, 0.0005)

    def raycast(self, ox: float, oy: float, angles: np.ndarray, max_range: float = 8.0) -> np.ndarray:
        """各方向の距離 [m]。何も無い方向は inf。"""
        step = self.map.res * 0.5
        n = int(max_range / step)
        ts = np.arange(1, n + 1) * step
        xs = ox + np.cos(angles)[:, None] * ts[None, :]
        ys = oy + np.sin(angles)[:, None] * ts[None, :]
        hit = self.map.occupied(xs, ys)
        for (cx, cy, r) in self.obstacles:
            hit |= (xs - cx) ** 2 + (ys - cy) ** 2 < r * r
        anyhit = hit.any(axis=1)
        return np.where(anyhit, ts[hit.argmax(axis=1)], np.inf)

    def laser_scan(self, mount: tuple[float, float, float], beams: int = 360, max_range: float = 8.0,
                   noise: float = 0.01, dropout: float = 0.03) -> tuple[np.ndarray, float, float]:
        """LiDAR の1周分。mount = 取り付け (x, y, yaw)。戻り値 (ranges, angle_min, angle_increment)。
        角度は ROS の LaserScan と同じ（LiDAR 座標で反時計回り, -π から）。"""
        x, y, th = self.pose()
        c, s = math.cos(th), math.sin(th)
        lx, ly = x + c * mount[0] - s * mount[1], y + s * mount[0] + c * mount[1]
        inc = 2.0 * math.pi / beams
        rel = -math.pi + inc * np.arange(beams)
        r = self.raycast(lx, ly, th + mount[2] + rel, max_range)
        r = r * (1.0 + self.rng.normal(0, noise, beams))
        r[self.rng.random(beams) < dropout] = np.inf
        return r, -math.pi, inc


class SimEsp32:
    """ESP32 の代わり。Esp32Link と同じ関数を持つ。
    指令タイムアウト・非常停止ラッチ・20Hz テレメトリを本物と同じように行う。"""

    def __init__(self, world: SimWorld, watchdog_s: float = 0.3):
        self.world = world
        self.watchdog_s = watchdog_s
        self.on_telemetry = None
        self.on_alert = None
        self.estop = False
        self.last_cmd = 0.0
        self.steer = 0.0
        self.thr = 0.0
        self.seq = 0
        self.last_rx = 0.0
        self.info = ["sim", "SIM_IMU", "SIM_PWM"]
        self.port = "sim"
        self._running = False
        self.t0 = time.time()

    @property
    def online(self) -> bool:
        return self._running

    def start(self) -> None:
        self._running = True
        threading.Thread(target=self._loop, name="sim-esp32", daemon=True).start()
        if self.on_alert:
            self.on_alert("BOOT", "sim")

    def stop(self) -> None:
        self._running = False

    def _loop(self) -> None:
        last = time.time()
        k = 0
        while self._running:
            now = time.time()
            dt = now - last
            last = now
            wd = now - self.last_cmd > self.watchdog_s
            if self.estop or wd:
                self.steer = self.steer if not self.estop else 0.0
                self.thr = 0.0
            self.world.set_command(self.steer, self.thr)
            self.world.step(dt)
            k += 1
            if k % 2 == 0 and self.on_telemetry:   # 20Hz
                w = self.world
                yaw_cdeg = int(round(math.degrees(math.atan2(math.sin(w.yaw_meas), math.cos(w.yaw_meas))) * 100))
                flags = protocol.FLAG_IMU_OK | protocol.FLAG_PWM_OK
                if self.estop:
                    flags |= protocol.FLAG_ESTOP
                if wd:
                    flags |= protocol.FLAG_WATCHDOG
                self.last_rx = now
                f = ["T", int((now - self.t0) * 1000), yaw_cdeg, 0, 7800, -1, -1, flags,
                     int(self.thr * 1000), int(self.steer * 1000), self.seq]
                self.on_telemetry(protocol.parse_telemetry([str(v) for v in f]))
            time.sleep(0.025)

    # ---- Esp32Link と同じ関数 ----
    def send_drive(self, seq, steer, throttle):
        self.seq = seq
        self.last_cmd = time.time()
        if not self.estop:
            self.steer, self.thr = float(steer), float(throttle)

    def send_stop(self):
        self.last_cmd = time.time()
        self.thr = 0.0

    def send_estop(self, code=1):
        self.estop = True
        self.last_cmd = time.time()

    def send_clear(self):
        self.estop = False

    def zero_yaw(self):
        self.world.yaw_meas = 0.0

    def set_param(self, *a):
        pass

    def save_params(self):
        pass

    def request_params(self):
        pass
