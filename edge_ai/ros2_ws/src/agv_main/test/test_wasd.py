"""WASD 操作の判定テスト（ROS なしで動く）:  python3 agv_main/test/test_wasd.py"""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agv_main.drive_model import CmdVelConverter, SpeedModel  # noqa: E402
from agv_main.wasd_teleop import HOLD_S, WasdState  # noqa: E402

VEH = {"wheelbase": 0.257, "max_steer_deg": 25.0}
conv = CmdVelConverter(VEH, SpeedModel({}))


def steer_thr(st, now):
    v, w = st.twist(now)
    return conv.convert(v, w)


def test_forward_and_release():
    st = WasdState(speed=0.15)
    st.key("w", 0.0)
    v, w = st.twist(0.1)
    assert v == 0.15 and w == 0.0
    assert st.twist(HOLD_S + 0.01) == (0.0, 0.0)   # 離したら止まる


def test_turn_while_driving_keeps_moving():
    st = WasdState(speed=0.15)
    st.key("w", 0.0)
    st.key("a", 0.5)            # W の繰り返しが止まっても A で走り続ける
    s, t = steer_thr(st, 0.9)
    assert t > 0 and math.isclose(s, 1.0, abs_tol=1e-6)   # 前進・ハンドル左いっぱい
    st.key("d", 1.0)
    s, t = steer_thr(st, 1.2)
    assert t > 0 and math.isclose(s, -1.0, abs_tol=1e-6)


def test_reverse_left_means_wheels_left():
    st = WasdState(speed=0.15)
    st.key("s", 0.0)
    st.key("a", 0.1)
    s, t = steer_thr(st, 0.2)
    assert t < 0 and s > 0.99   # 後退でも A = タイヤは左


def test_steer_only_when_stopped():
    st = WasdState()
    st.key("D", 0.0)            # 大文字でもよい
    s, t = steer_thr(st, 0.1)
    assert t == 0.0 and s < 0   # ハンドルだけ右


def test_a_alone_does_not_start_driving():
    st = WasdState()
    st.key("a", 0.0)
    v, _ = st.twist(0.1)
    assert v == 0.0


def test_space_stops_and_speed_limits():
    st = WasdState(speed=0.15)
    st.key("w", 0.0)
    st.key(" ", 0.1)
    assert st.twist(0.2) == (0.0, 0.0)
    for _ in range(50):
        st.key("+", 0.3)
    assert st.speed == 1.0
    for _ in range(50):
        st.key("-", 0.3)
    assert st.speed == 0.05
    st.key("q", 0.4)
    assert st.quit


if __name__ == "__main__":
    n = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("OK", name)
            n += 1
    print(f"すべて成功（{n} 件）")
