"""ラズパイの安全ガード。Nav2 から来た走行指令（/cmd_vel）を、ESP32 に渡す前にチェックする。

Nav2 にも障害物回避はあるが、こちらはラズパイだけで完結する「最後の砦」。
Wi-Fi が切れても PC1 が固まっても、ここで止まる。

- 進む方向（前進なら前, 後退なら後ろ）に障害物が近ければ止める / 減速する
- ハンドルを切っているときは、曲がっていく先（円弧）を調べる
- 止まった状態が長く続いたら Web に「BLOCKED」と知らせる（障害物がどけば自動で再開）
- LiDAR が止まっている・PC1 (Nav2) から指令が来ない → 止める
- 緊急停止（Web のボタン・車体のボタン）はラッチ（解除操作まで動かない）
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

CLEAR, SLOW, HOLD, BLOCKED, ESTOP, NO_LIDAR, NO_COMMAND = (
    "CLEAR", "SLOW", "HOLD", "BLOCKED", "ESTOP", "NO_LIDAR", "NO_COMMAND")


def path_clearance(points: np.ndarray, curvature: float, half_width: float, front_offset: float,
                   reverse: bool = False, max_dist: float = 5.0) -> float:
    """車体がこのまま（曲率 curvature で）進んだとき、何 m 先で障害物にぶつかるか。
    （ai_server/agv_ai/scan_utils.py と同じ計算）"""
    if points is None or len(points) == 0:
        return max_dist
    x = points[:, 0].copy()
    y = points[:, 1]
    if reverse:
        x = -x
        curvature = -curvature
    if abs(curvature) < 1e-3:
        m = (x > 0) & (np.abs(y) <= half_width)
        if not m.any():
            return max_dist
        return float(max(0.0, x[m].min() - front_offset))
    R = 1.0 / curvature
    rho = np.hypot(x, y - R)
    lateral = np.abs(rho - abs(R))
    ang = np.mod(np.arctan2(x, (R - y) * math.copysign(1.0, R)), 2 * math.pi)
    m = (lateral <= half_width) & (ang > 0) & (ang < math.pi)
    if not m.any():
        return max_dist
    return float(max(0.0, min(max_dist, (ang[m] * abs(R)).min() - front_offset)))


@dataclass
class SafetyResult:
    steer: float
    throttle: float
    state: str
    reason: str = ""
    clearance: float = 5.0
    events: list[dict] = field(default_factory=list)   # Web に通知する emergency


class SafetyGuard:
    def __init__(self, cfg):
        self.half_width = float(cfg.get("robot_width", 0.19)) / 2.0 + float(cfg.get("side_margin", 0.05))
        self.half_length = float(cfg.get("robot_length", 0.42)) / 2.0
        self.wheelbase = float(cfg.get("wheelbase", 0.257))
        self.max_steer = math.radians(float(cfg.get("max_steer_deg", 25.0)))
        self.stop_d = float(cfg.get("stop_distance", 0.22))
        self.speed_gain = float(cfg.get("speed_gain", 0.35))
        self.slow_d = float(cfg.get("slow_distance", 0.55))
        self.escalate_s = float(cfg.get("block_escalate_s", 15))
        self.require_lidar = bool(cfg.get("require_lidar", True))
        self.lidar_timeout = float(cfg.get("lidar_timeout_s", 0.6))
        self.drive_timeout = float(cfg.get("drive_timeout_s", 0.5))
        self.max_thr = float(cfg.get("max_throttle", 0.6))

        self.estop_latched = False
        self.estop_reason = ""
        self.estop_code = ""
        self.state = CLEAR
        self._hold_since: float | None = None
        self._clear_since: float | None = None
        self._blocked_reported = False
        self._no_lidar_since: float | None = None
        self._lidar_reported = False
        self._comm_reported = False
        self._last_moving_cmd = 0.0

    def latch_estop(self, code: str, reason: str) -> None:
        self.estop_latched = True
        self.estop_code = code
        self.estop_reason = reason

    def clear_estop(self) -> None:
        self.estop_latched = False
        self.estop_reason = ""
        self.estop_code = ""

    def evaluate(self, now: float, steer: float, throttle: float, cmd_time: float,
                 points: np.ndarray | None, scan_time: float,
                 last_cmd_moving: bool | None = None) -> SafetyResult:
        """last_cmd_moving: 最後に届いた指令が「走れ」だったか。
        Nav2 は目的地に着くと速度 0 を送ってから送信をやめるので、
        「止まれ」の後に指令が来なくなるのは正常（COMM_LOST にしない）。"""
        events: list[dict] = []
        throttle = max(-self.max_thr, min(self.max_thr, throttle))
        steer = max(-1.0, min(1.0, steer))

        if self.estop_latched:
            return self._finish(SafetyResult(0.0, 0.0, ESTOP, self.estop_reason), now)

        # PC1 からの指令が途切れた
        if now - cmd_time > self.drive_timeout:
            was_moving = (now - self._last_moving_cmd < self.drive_timeout + 1.0) if last_cmd_moving is None \
                else (last_cmd_moving and now - cmd_time < self.drive_timeout + 1.0)
            if not self._comm_reported and was_moving:
                self._comm_reported = True
                events.append({"code": "COMM_LOST", "reason": "走行中に PC1 (Nav2) からの指令が途切れたため停止しました", "source": "pi"})
            return self._finish(SafetyResult(0.0, 0.0, NO_COMMAND, "指令待ち", events=events), now)
        self._comm_reported = False
        if abs(throttle) > 0.01:
            self._last_moving_cmd = now

        # LiDAR が止まっている
        if self.require_lidar and (points is None or now - scan_time > self.lidar_timeout):
            if self._no_lidar_since is None:
                self._no_lidar_since = now
            if not self._lidar_reported and now - self._no_lidar_since > 2.0:
                self._lidar_reported = True
                events.append({"code": "LIDAR_FAIL", "reason": "LiDAR のデータが来ないため走行できません", "source": "pi"})
            return self._finish(SafetyResult(steer, 0.0, NO_LIDAR, "LiDAR データなし", events=events), now)
        self._no_lidar_since = None
        self._lidar_reported = False

        if abs(throttle) < 0.01:
            return self._finish(SafetyResult(steer, 0.0, CLEAR, events=events), now)

        reverse = throttle < 0
        curv = math.tan(steer * self.max_steer) / self.wheelbase
        clearance = path_clearance(points, curv, self.half_width, self.half_length, reverse=reverse)
        stop_d = self.stop_d + self.speed_gain * abs(throttle)
        side = "後方" if reverse else "前方"
        if clearance <= stop_d:
            res = SafetyResult(steer, 0.0, HOLD, f"{side}障害物 {clearance:.2f}m", clearance, events)
        elif clearance < self.slow_d + self.speed_gain * abs(throttle):
            span = max(1e-3, self.slow_d - self.stop_d)
            k = max(0.4, min(1.0, (clearance - stop_d) / span))
            res = SafetyResult(steer, throttle * k, SLOW, f"{side}障害物で減速 {clearance:.2f}m", clearance, events)
        else:
            res = SafetyResult(steer, throttle, CLEAR, "", clearance, events)
        return self._finish(res, now)

    def _finish(self, res: SafetyResult, now: float) -> SafetyResult:
        # HOLD が長く続いたら BLOCKED として一度だけ通知
        if res.state == HOLD:
            self._clear_since = None
            if self._hold_since is None:
                self._hold_since = now
            if now - self._hold_since > self.escalate_s:
                res.state = BLOCKED
                if not self._blocked_reported:
                    self._blocked_reported = True
                    res.events.append({"code": "BLOCKED", "source": "lidar",
                                       "reason": f"{res.reason} のため {self.escalate_s:.0f} 秒以上停止中",
                                       "distance_mm": int(res.clearance * 1000)})
        elif res.state in (CLEAR, SLOW):
            if self._clear_since is None:
                self._clear_since = now
            if now - self._clear_since > 1.0:
                self._hold_since = None
                self._blocked_reported = False
        self.state = res.state
        return res
