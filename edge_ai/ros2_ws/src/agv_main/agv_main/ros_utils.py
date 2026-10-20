"""ROS ノードで共通に使う小物（パラメータ・QoS・角度・JSON 文字列トピック）。"""
from __future__ import annotations

import json
import math

from rcl_interfaces.msg import ParameterDescriptor
from rclpy.qos import DurabilityPolicy, HistoryPolicy, QoSProfile, ReliabilityPolicy
from std_msgs.msg import String

# 「最新の状態を1つ残しておく」トピック（後から起動したノードも最新の値を受け取れる）
LATCHED = QoSProfile(depth=1, reliability=ReliabilityPolicy.RELIABLE,
                     durability=DurabilityPolicy.TRANSIENT_LOCAL, history=HistoryPolicy.KEEP_LAST)
# 取りこぼしたくないイベント
EVENTS = QoSProfile(depth=20, reliability=ReliabilityPolicy.RELIABLE,
                    durability=DurabilityPolicy.VOLATILE, history=HistoryPolicy.KEEP_LAST)
# センサー（多少落ちてもよいので最新を優先）。rclpy.qos.qos_profile_sensor_data と同じ
SENSOR = QoSProfile(depth=5, reliability=ReliabilityPolicy.BEST_EFFORT,
                    durability=DurabilityPolicy.VOLATILE, history=HistoryPolicy.KEEP_LAST)


class Cfg(dict):
    """dict を cfg.safety.stop_distance のようにも読めるようにしたもの。"""

    def __getattr__(self, k):
        try:
            return self[k]
        except KeyError as e:
            raise AttributeError(k) from e


def declare_tree(node, defaults: dict, prefix: str = "") -> Cfg:
    """入れ子の dict をそのまま ROS パラメータとして宣言し、yaml で上書きされた値を入れ子の dict で返す。
    例: {"safety": {"stop_distance": 0.22}} → パラメータ名 "safety.stop_distance"
    （yaml に 0 と 0.0 のどちらで書いても困らないよう、型は固定しない）"""
    out = Cfg()
    for k, v in defaults.items():
        name = f"{prefix}{k}"
        if isinstance(v, dict):
            out[k] = declare_tree(node, v, name + ".")
        else:
            node.declare_parameter(name, v, ParameterDescriptor(dynamic_typing=True))
            val = node.get_parameter(name).value
            if isinstance(val, (list, tuple)):
                val = list(val)
            out[k] = val
    return out


def yaw_to_quat(yaw: float):
    """(x, y, z, w)"""
    return 0.0, 0.0, math.sin(yaw / 2.0), math.cos(yaw / 2.0)


def rpy_to_quat(roll: float, pitch: float, yaw: float):
    """(x, y, z, w)。static_transform_publisher と同じ（固定軸 X→Y→Z）"""
    cr, sr = math.cos(roll / 2), math.sin(roll / 2)
    cp, sp = math.cos(pitch / 2), math.sin(pitch / 2)
    cy, sy = math.cos(yaw / 2), math.sin(yaw / 2)
    return (sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy,
            cr * cp * sy - sr * sp * cy, cr * cp * cy + sr * sp * sy)


def quat_to_yaw(q) -> float:
    return math.atan2(2.0 * (q.w * q.z + q.x * q.y), 1.0 - 2.0 * (q.y * q.y + q.z * q.z))


def set_quat(msg_q, yaw: float) -> None:
    msg_q.x, msg_q.y, msg_q.z, msg_q.w = yaw_to_quat(yaw)


def json_msg(payload: dict) -> String:
    m = String()
    m.data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return m


def parse_json(msg: String) -> dict:
    try:
        d = json.loads(msg.data) if msg.data else {}
        return d if isinstance(d, dict) else {"value": d}
    except ValueError:
        return {}


def stamp_to_sec(stamp) -> float:
    return float(stamp.sec) + float(stamp.nanosec) * 1e-9
