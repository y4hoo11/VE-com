"""RPLIDAR A1 (A1M8) の簡易ドライバ（外部ライブラリ不要, pyserial だけ）。

Slamtec の通信仕様（標準スキャンモード）:
  要求:  0xA5 0x20 (SCAN) / 0xA5 0x25 (STOP) / 0xA5 0x40 (RESET) / 0xA5 0x52 (GET_HEALTH)
  応答の先頭(7バイト): 0xA5 0x5A <長さ4バイト(下位30bit)+モード2bit> <種類1バイト>
  スキャンの1点 = 5バイト:
     b0: 品質(6bit)<<2 | !S<<1 | S       S=1 なら1周の始まり
     b1: 角度[6:0]<<1 | C(=1)
     b2: 角度[14:7]                        角度[deg] = 値 / 64
     b3,b4: 距離 (リトルエンディアン)       距離[mm] = 値 / 4   (0 = 測定不可)
  A1 + 付属USBアダプタでは、モーターは DTR 信号で ON/OFF する（DTR=False で回る）。

1周分たまるごとに on_scan(angles_deg[], dist_mm[], qualities[]) を呼ぶ（角度は LiDAR の生の値）。
"""
from __future__ import annotations

import glob
import logging
import math
import threading
import time
from typing import Callable

import numpy as np
try:
    import serial  # python3-serial（pyserial）
except ImportError:  # シミュレーターやテストだけなら無くてもよい
    serial = None

log = logging.getLogger("lidar")

SYNC = 0xA5
CMD_STOP, CMD_RESET, CMD_SCAN, CMD_HEALTH = 0x25, 0x40, 0x20, 0x52
SCAN_DESCRIPTOR = bytes([0xA5, 0x5A, 0x05, 0x00, 0x00, 0x40, 0x81])


def find_lidar_port() -> str | None:
    for pat in ("/dev/serial/by-id/*CP210*", "/dev/serial/by-id/*Silicon_Labs*", "/dev/ttyUSB*"):
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[0]
    return None


def decode_node(b: bytes) -> tuple[bool, int, float, float] | None:
    """5バイト → (新しい周の始まりか, 品質, 角度deg, 距離mm)。不正なら None。"""
    s = b[0] & 0x01
    ns = (b[0] >> 1) & 0x01
    if s == ns or (b[1] & 0x01) != 1:
        return None
    quality = b[0] >> 2
    angle = ((b[1] >> 1) | (b[2] << 7)) / 64.0
    dist = (b[3] | (b[4] << 8)) / 4.0
    return bool(s), quality, angle, dist


def bin_scan(angles_deg, dists_mm, quals, bins: int, min_quality: int, rmin: float, rmax: float) -> np.ndarray:
    """生の1周分 → 等間隔（angle_min=-π から反時計回り）の ranges。点が無いところは inf。"""
    a = np.radians(np.asarray(angles_deg, dtype=np.float64))
    r = np.asarray(dists_mm, dtype=np.float64) / 1000.0
    q = np.asarray(quals)
    ok = (q >= min_quality) & (r >= rmin) & (r <= rmax)
    ros_a = (math.pi - a[ok] + math.pi) % (2 * math.pi) - math.pi     # π − 生の角度 を -π〜π に
    inc = 2 * math.pi / bins
    idx = np.floor((ros_a + math.pi) / inc + 0.5).astype(int) % bins
    out = np.full(bins, np.inf)
    rr = r[ok]
    # 同じ枠に複数あれば近い方（安全側）
    np.minimum.at(out, idx, rr)
    return out


class RPLidarA1:
    def __init__(self, port: str = "auto", baud: int = 115200,
                 on_scan: Callable[[list[float], list[float], list[int]], None] | None = None):
        self.port_cfg = port
        self.baud = int(baud)
        self.on_scan = on_scan
        self.ser: serial.Serial | None = None
        self._running = False
        self._thread: threading.Thread | None = None
        self.last_scan_time = 0.0
        self.scan_hz = 0.0
        self.errors = 0

    def start(self) -> None:
        self._running = True
        self._thread = threading.Thread(target=self._loop, name="lidar", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._running = False
        self._shutdown_device()

    # ------------------------------------------------------------------
    def _set_motor(self, on: bool) -> None:
        # A1 の USB アダプタは DTR=False でモーターが回る（対応していない変換器では何もしない）
        try:
            self.ser.dtr = not on
        except Exception:
            pass

    def _cmd(self, cmd: int) -> None:
        self.ser.write(bytes([SYNC, cmd]))

    def _shutdown_device(self) -> None:
        if self.ser is None:
            return
        try:
            self._cmd(CMD_STOP)
            time.sleep(0.01)
            self._set_motor(False)
            self.ser.close()
        except Exception:
            pass
        self.ser = None

    def _open_and_start(self) -> bool:
        port = find_lidar_port() if self.port_cfg in (None, "", "auto") else self.port_cfg
        if not port:
            log.warning("LiDAR のポートが見つかりません（USB接続を確認）")
            return False
        try:
            self.ser = serial.Serial(port, self.baud, timeout=1.0)
            self._set_motor(True)
            time.sleep(0.05)
            self._cmd(CMD_STOP)
            time.sleep(0.05)
            self.ser.reset_input_buffer()
            health = self._get_health()
            if health is not None:
                status = ["正常", "警告", "エラー"][min(health[0], 2)]
                log.info("LiDAR ヘルス: %s (エラーコード %d)", status, health[1])
                if health[0] == 2:
                    log.warning("LiDAR がエラー状態なのでリセットします")
                    self._cmd(CMD_RESET)
                    time.sleep(1.0)
                    self.ser.reset_input_buffer()
            time.sleep(0.5)            # モーターの回転が安定するまで待つ
            self.ser.reset_input_buffer()
            self._cmd(CMD_SCAN)
            desc = self.ser.read(7)
            if desc != SCAN_DESCRIPTOR:
                log.warning("LiDAR のスキャン応答が想定外: %s", desc.hex())
                self._shutdown_device()
                return False
            log.info("LiDAR スキャン開始: %s", port)
            return True
        except Exception as e:
            log.warning("LiDAR を開けません (%s): %s", port, e)
            self._shutdown_device()
            return False

    def _get_health(self) -> tuple[int, int] | None:
        self._cmd(CMD_HEALTH)
        desc = self.ser.read(7)
        if len(desc) != 7 or desc[0] != 0xA5 or desc[1] != 0x5A:
            self.ser.reset_input_buffer()
            return None
        data = self.ser.read(3)
        if len(data) != 3:
            return None
        return data[0], data[1] | (data[2] << 8)

    def _loop(self) -> None:
        while self._running:
            if self.ser is None and not self._open_and_start():
                time.sleep(2.0)
                continue
            try:
                self._read_scans()
            except Exception as e:
                self.errors += 1
                log.warning("LiDAR 読み込みエラー（再起動します）: %s", e)
                self._shutdown_device()
                time.sleep(1.0)

    def _read_scans(self) -> None:
        angles: list[float] = []
        dists: list[float] = []
        quals: list[int] = []
        buf = b""
        bad = 0
        while self._running:
            need = 5 - len(buf)
            chunk = self.ser.read(need)
            if not chunk:
                raise IOError("LiDAR からデータが来ません")
            buf += chunk
            if len(buf) < 5:
                continue
            node = decode_node(buf)
            if node is None:
                buf = buf[1:]   # 1バイトずらして同期を取り直す
                bad += 1
                if bad > 2000:
                    raise IOError("同期が取れません")
                continue
            bad = 0
            buf = b""
            start, q, a, d = node
            if start:
                if len(angles) > 30:   # 起動直後の途中から始まった周は捨てる
                    now = time.time()
                    if self.last_scan_time:
                        self.scan_hz = 0.8 * self.scan_hz + 0.2 / max(1e-3, now - self.last_scan_time)
                    self.last_scan_time = now
                    if self.on_scan:
                        self.on_scan(angles, dists, quals)
                angles, dists, quals = [], [], []
            angles.append(a)
            dists.append(d)
            quals.append(q)
