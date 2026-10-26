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
    "rates": {"control_hz": 20.0, "info_hz": 1.0},
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
