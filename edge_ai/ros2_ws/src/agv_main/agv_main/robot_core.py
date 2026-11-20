"""ラズパイ側の「判断」部分（ROS に依存しない）。serial_bridge と sim_robot の両方で使う。

    /cmd_vel (v, ω) ──► CmdVelConverter ──► SafetyGuard ──► ESP32 へ ($D / $S / $E)
    /scan ──────────────────────────────────┘
    ESP32 テレメトリ ($T) ──► WheelOdometry ──► /odom, TF odom→base_link
"""
from __future__ import annotations

import copy
import math
import threading
from dataclasses import dataclass, field

import numpy as np

from .drive_model import CmdVelConverter, SpeedModel, WheelOdometry
from .safety import ESTOP, NO_COMMAND, SafetyGuard, SafetyResult


ROBOT_DEFAULTS = {
    "agv_id": "AGV-01",
    "name": "1号機",
    "publish_tf": True,
    "publish_static_tf": True,
    "frames": {"odom": "odom", "base": "base_link", "laser": "laser", "camera": "camera_link",
               "camera_optical": "camera_optical_frame"},
    "esp32": {"port": "auto", "baud": 115200},
    "vehicle": {"wheelbase": 0.257, "max_steer_deg": 25.0, "length": 0.42, "width": 0.19},
    "speed_model": {"deadband": 0.06, "gain_mps": 2.4, "min_speed": 0.12, "tau_s": 0.25, "ticks_per_meter": 0.0},
    "laser": {"x": 0.05, "y": 0.0, "z": 0.12, "yaw_deg": 0.0, "min_range": 0.12, "max_range": 8.0},
    "camera_mount": {"x": 0.18, "y": 0.0, "z": 0.15, "pitch_deg": 15.0, "yaw_deg": 0.0},
    "safety": {
        "side_margin": 0.05, "stop_distance": 0.22, "speed_gain": 0.35, "slow_distance": 0.55,
        "block_escalate_s": 15.0, "require_lidar": True, "lidar_timeout_s": 0.6,
        "drive_timeout_s": 0.5, "max_throttle": 0.6,
    },
    "battery": {"empty_v": 6.6, "full_v": 8.2},
    "rates": {"control_hz": 20.0, "info_hz": 1.0, "clearance_hz": 5.0},
}


def deep_merge(a: dict, b: dict) -> dict:
    out = copy.deepcopy(a)
    for k, v in (b or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


@dataclass
class DriveDecision:
    kind: str                  # "drive" / "stop" / "estop"
    steer: float = 0.0
    throttle: float = 0.0
    result: SafetyResult | None = None
    events: list[dict] = field(default_factory=list)


def scan_to_points(ranges, angle_min: float, angle_increment: float, mount: tuple[float, float, float],
                   min_range: float, max_range: float) -> np.ndarray:
    """LaserScan → 車体座標 (base_link) の点 [N,2]。mount = LiDAR の取り付け (x, y, yaw)。"""
    r = np.asarray(ranges, dtype=np.float64)
    a = angle_min + angle_increment * np.arange(len(r)) + mount[2]
    ok = np.isfinite(r) & (r >= min_range) & (r <= max_range)
    r, a = r[ok], a[ok]
    return np.column_stack([mount[0] + r * np.cos(a), mount[1] + r * np.sin(a)])


# Web の車両詳細ページの「アラウンドビュー」（SonarView）に出す 8 方向（Web の scan8 と同じ並び）。
# 前から反時計回り（左回り）に 45° ずつ、それぞれ ±22.5° の範囲
SCAN8_NAMES = ("前", "左前", "左", "左後", "後", "右後", "右", "右前")


def scan8(points, length: float, width: float) -> list[float | None]:
    """車体のまわり 8 方向それぞれで、車体の外形（長方形）からいちばん近い物までの距離 [m]。

    points は車体座標 (base_link。x が前、y が左) の点 [N,2]。並びは SCAN8_NAMES。物が見えない方向は None。
    車体の外形の内側に入る点（車体自身の反射）は数えない。
    """
    out: list[float | None] = [None] * 8
    if points is None or len(points) == 0:
        return out
    p = np.asarray(points, dtype=np.float64)
    x, y = p[:, 0], p[:, 1]
    d = np.hypot(np.maximum(np.abs(x) - length / 2.0, 0.0), np.maximum(np.abs(y) - width / 2.0, 0.0))
    ang = np.degrees(np.arctan2(y, x))                        # 前 0°、左回り +
    k = np.floor(((ang + 22.5) % 360.0) / 45.0).astype(int) % 8   # 0 = 前（-22.5〜22.5°）、1 = 左前 …
    outside = d > 0.0
    for i in range(8):
        m = outside & (k == i)
        if m.any():
            out[i] = round(float(d[m].min()), 2)
    return out


class RobotCore:
    def __init__(self, cfg):
        veh = cfg["vehicle"]
        safety_cfg = dict(cfg["safety"])
        # 車体の寸法は vehicle に1か所だけ書く（安全ガードにも渡す）
        safety_cfg["robot_length"] = float(veh.get("length", 0.42))
        safety_cfg["robot_width"] = float(veh.get("width", 0.19))
        safety_cfg["wheelbase"] = float(veh.get("wheelbase", 0.257))
        safety_cfg["max_steer_deg"] = float(veh.get("max_steer_deg", 25.0))
        self.guard = SafetyGuard(safety_cfg)
        sm_cfg = cfg["speed_model"]
        self.speed_model = SpeedModel(sm_cfg)
        self.converter = CmdVelConverter(veh, self.speed_model)
        self.body_length = float(veh.get("length", 0.42))
        self.body_width = float(veh.get("width", 0.19))
        self.odom = WheelOdometry(veh, self.speed_model, float(sm_cfg.get("tau_s", 0.25)),
                                  float(sm_cfg.get("ticks_per_meter", 0.0)))
        lz = cfg["laser"]
        self.laser_mount = (float(lz.get("x", 0.05)), float(lz.get("y", 0.0)), math.radians(float(lz.get("yaw_deg", 0.0))))
        self.min_range = float(lz.get("min_range", 0.12))   # これより近い点は車体自身の反射として無視
        self.max_range = float(lz.get("max_range", 8.0))

        self.lock = threading.Lock()
        self.cmd_v = 0.0
        self.cmd_w = 0.0
        self.cmd_time = 0.0
        self.points: np.ndarray | None = None
        self.scan_time = 0.0
        self.last: DriveDecision | None = None

    # ---- 入力 ----
    def set_cmd_vel(self, v: float, w: float, now: float) -> None:
        with self.lock:
            self.cmd_v, self.cmd_w, self.cmd_time = float(v), float(w), now

    def set_scan(self, ranges, angle_min: float, angle_increment: float, now: float) -> np.ndarray:
        pts = scan_to_points(ranges, angle_min, angle_increment, self.laser_mount, self.min_range, self.max_range)
        with self.lock:
            self.points = pts
            self.scan_time = now
        return pts

    def scan8(self, now: float, max_age: float = 1.0) -> list[float | None] | None:
        """8 方向の距離 [m]（Web のアラウンドビュー用）。LiDAR のデータが古いときは None。"""
        with self.lock:
            pts, st = self.points, self.scan_time
        if pts is None or now - st > max_age:
            return None
        return scan8(pts, self.body_length, self.body_width)

    def on_telemetry(self, t: dict, now: float) -> bool:
        return self.odom.update(t, now)

    def latch_estop(self, code: str, reason: str) -> bool:
        """緊急停止をラッチ。新しくラッチしたら True。"""
        first = not self.guard.estop_latched
        self.guard.latch_estop(code, reason)
        return first

    def clear_estop(self) -> None:
        self.guard.clear_estop()

    # ---- 判断（制御周期ごと）----
    def step(self, now: float) -> DriveDecision:
        with self.lock:
            v, w, ct = self.cmd_v, self.cmd_w, self.cmd_time
            pts, st = self.points, self.scan_time
        steer, thr = self.converter.convert(v, w) if ct > 0 else (0.0, 0.0)
        res = self.guard.evaluate(now, steer, thr, ct, pts, st, last_cmd_moving=abs(v) > 0.01)
        if res.state == ESTOP:
            d = DriveDecision("estop", 0.0, 0.0, res, res.events)
        elif res.state == NO_COMMAND:
            d = DriveDecision("stop", 0.0, 0.0, res, res.events)
        else:
            d = DriveDecision("drive", res.steer, res.throttle, res, res.events)
        self.last = d
        return d
