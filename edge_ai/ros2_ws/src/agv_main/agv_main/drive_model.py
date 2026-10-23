"""ROS の速度指令（/cmd_vel）と TT-02 のステア・スロットルの変換、およびオドメトリ（自分の動きの積算）。

ROS（Nav2）は「前に v [m/s] で進みながら ω [rad/s] で回れ」という形（geometry_msgs/Twist）で指令を出す。
TT-02 は車（アッカーマン）なので、その場で回ることはできない。自転車モデルで舵角に直す:

    ω = v · tan(δ) / L      →      δ = atan(L · ω / v)
    （L = ホイールベース, δ = 前輪の舵角。後退中 v < 0 でも同じ式で正しい向きになる）

スロットルは「速度モデル」で決める（エンコーダが無いので、実測した係数で速度に直す）:

    v = gain · (|throttle| − deadband)    （|throttle| > deadband のとき）

オドメトリ（/odom と TF odom→base_link）は、ESP32 が「実際に出したスロットル」と IMU のヨー角から作る。
"""
from __future__ import annotations

import math
from dataclasses import dataclass


def _clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x


def wrap_angle(a: float) -> float:
    return (a + math.pi) % (2.0 * math.pi) - math.pi


class SpeedModel:
    """スロットル（-1〜1）と速度 [m/s] の変換。gain は teleop で一定スロットルで走らせて実測する。"""

    def __init__(self, cfg):
        self.deadband = float(cfg.get("deadband", 0.06))
        self.gain = float(cfg.get("gain_mps", 2.4))
        self.min_speed = float(cfg.get("min_speed", 0.12))   # これより遅い指令は、この速さに引き上げる（止まってしまうため）

    def thr_to_speed(self, thr: float) -> float:
        a = abs(thr)
        if a <= self.deadband:
            return 0.0
        return math.copysign(self.gain * (a - self.deadband), thr)

    def speed_to_thr(self, v: float) -> float:
        if abs(v) < 0.01:
            return 0.0
        v = math.copysign(max(abs(v), self.min_speed), v)
        return math.copysign(min(1.0, self.deadband + abs(v) / self.gain), v)


class CmdVelConverter:
    """Twist (v, ω) → (steer -1〜1 [+が左], throttle -1〜1 [+が前進])"""

    def __init__(self, vehicle_cfg, speed_model: SpeedModel):
        self.L = float(vehicle_cfg.get("wheelbase", 0.257))
        self.max_steer = math.radians(float(vehicle_cfg.get("max_steer_deg", 25.0)))
        self.speed = speed_model
        self.last_steer = 0.0

    def convert(self, v: float, w: float) -> tuple[float, float]:
        if abs(v) < 0.01:
            # その場旋回はできない。回転の指令だけ来たら、ハンドルだけ切って待つ（止まる）
            if abs(w) > 0.05:
                self.last_steer = math.copysign(1.0, w)
            return self.last_steer, 0.0
        delta = math.atan(self.L * w / v)
        steer = _clamp(delta / self.max_steer, -1.0, 1.0)
        self.last_steer = steer
        return steer, self.speed.speed_to_thr(v)

    def curvature(self, steer: float) -> float:
        return math.tan(steer * self.max_steer) / self.L


@dataclass
class OdomState:
    x: float = 0.0
    y: float = 0.0
    yaw: float = 0.0
    v: float = 0.0        # [m/s]（前進が +）
    w: float = 0.0        # [rad/s]（反時計回りが +）
    distance: float = 0.0  # 走った距離の合計 [m]


class WheelOdometry:
    """ESP32 のテレメトリ（20Hz）からオドメトリを積算する。

    - 速度: エンコーダがあればエンコーダ、無ければ「実際に出したスロットル」から速度モデルで推定
            （ESC とモーターの遅れを 1 次遅れ tau_s で再現する）
    - 向き: IMU のヨー角の差分（IMU が壊れているときは舵角から計算）
    """

    def __init__(self, vehicle_cfg, speed_model: SpeedModel, tau_s: float = 0.25, ticks_per_meter: float = 0.0):
        self.L = float(vehicle_cfg.get("wheelbase", 0.257))
        self.max_steer = math.radians(float(vehicle_cfg.get("max_steer_deg", 25.0)))
        self.speed = speed_model
        self.tau = max(0.0, float(tau_s))
        self.ticks_per_m = float(ticks_per_meter or 0.0)
        self.state = OdomState()
        self._last: dict | None = None
        self._v_model = 0.0

    def reset(self) -> None:
        self.state = OdomState()
        self._last = None
        self._v_model = 0.0

    def update(self, t: dict, now: float) -> bool:
        """テレメトリ1件を反映する。積算したら True。"""
        last = self._last
        self._last = {"ms": t.get("ms"), "now": now, "yaw_deg": t.get("yaw_deg"), "enc": t.get("enc")}
        if last is None:
            return False
        dt = None
        if t.get("ms") is not None and last.get("ms") is not None:
            dms = int(t["ms"]) - int(last["ms"])
            if 0 < dms < 1000:
                dt = dms / 1000.0
        if dt is None:
            dt = now - float(last["now"])
        if dt <= 0.0 or dt > 0.5:   # 間が空きすぎ（ESP32 の再起動など）は積算しない
            self.state.v = 0.0
            self.state.w = 0.0
            return False

        thr = float(t.get("thr", 0.0))
        steer = float(t.get("steer", 0.0))
        enc, enc0 = t.get("enc"), last.get("enc")
        if self.ticks_per_m > 0 and enc is not None and enc0 is not None and enc >= 0 and enc0 >= 0:
            v = (float(enc) - float(enc0)) / self.ticks_per_m / dt
            if thr < 0:
                v = -abs(v)
        else:
            target = self.speed.thr_to_speed(thr)
            k = 1.0 if self.tau <= 0 else min(1.0, dt / self.tau)
            self._v_model += (target - self._v_model) * k
            if abs(self._v_model) < 1e-3:
                self._v_model = 0.0
            v = self._v_model

        if t.get("imu_ok", True) and t.get("yaw_deg") is not None and last.get("yaw_deg") is not None:
            dyaw = wrap_angle(math.radians(float(t["yaw_deg"]) - float(last["yaw_deg"])))
        else:
            dyaw = v * math.tan(steer * self.max_steer) / self.L * dt

        s = self.state
        mid = s.yaw + 0.5 * dyaw
        s.x += v * dt * math.cos(mid)
        s.y += v * dt * math.sin(mid)
        s.yaw = wrap_angle(s.yaw + dyaw)
        s.v = v
        s.w = dyaw / dt
        s.distance += abs(v) * dt
        return True
