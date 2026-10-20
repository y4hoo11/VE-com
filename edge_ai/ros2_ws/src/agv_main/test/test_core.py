"""agv_main の「判断」部分のテスト（ROS も実機もいらない）。

    cd edge_ai/ros2_ws/src/agv_main
    python3 -m pytest test -q
    （colcon test --packages-select agv_main でも動く）
"""
from __future__ import annotations

import math
import os
import sys
import time
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from agv_main import protocol  # noqa: E402
from agv_main.drive_model import CmdVelConverter, SpeedModel, WheelOdometry  # noqa: E402
from agv_main.robot_core import ROBOT_DEFAULTS, RobotCore, deep_merge, scan_to_points  # noqa: E402
from agv_main.rplidar_a1 import bin_scan, decode_node  # noqa: E402
from agv_main.safety import BLOCKED, CLEAR, ESTOP, HOLD, NO_COMMAND, NO_LIDAR, SLOW, SafetyGuard  # noqa: E402
from agv_main.sim_world import SimWorld  # noqa: E402

MAP = ROOT.parent / "agv_navigation" / "maps" / "demo_map.yaml"


def guard_cfg():
    c = dict(ROBOT_DEFAULTS["safety"])
    c.update({"robot_length": 0.42, "robot_width": 0.19, "wheelbase": 0.257, "max_steer_deg": 25.0})
    return c


class TestProtocol(unittest.TestCase):
    def test_roundtrip(self):
        line = protocol.drive(15, 0.25, -0.3).decode()
        self.assertEqual(line, "$D,15,250,-300*45\n")
        self.assertEqual(protocol.parse(line), ["D", "15", "250", "-300"])

    def test_bad_checksum(self):
        self.assertIsNone(protocol.parse("$D,15,250,-300*46"))
        self.assertIsNone(protocol.parse("D,15*00"))

    def test_telemetry(self):
        body = "T,1234,-9050,1500,7800,350,-1,25,300,-200,42"
        t = protocol.parse_telemetry(protocol.parse(f"${body}*{protocol.checksum(body)}"))
        self.assertAlmostEqual(t["yaw_deg"], -90.5)
        self.assertAlmostEqual(t["vbat"], 7.8)
        self.assertTrue(t["estop"] and t["imu_ok"] and t["pwm_ok"])
        self.assertFalse(t["watchdog"])
        self.assertAlmostEqual(t["thr"], 0.3)


class TestLidar(unittest.TestCase):
    def test_node(self):
        q, s = 15, 1
        angle_q6 = int(90.0 * 64)
        dist_q2 = 1000 * 4
        b = bytes([(q << 2) | ((1 - s) << 1) | s, ((angle_q6 & 0x7F) << 1) | 1, angle_q6 >> 7, dist_q2 & 0xFF, dist_q2 >> 8])
        start, qq, a, d = decode_node(b)
        self.assertTrue(start)
        self.assertEqual(qq, 15)
        self.assertAlmostEqual(a, 90.0)
        self.assertAlmostEqual(d, 1000.0)
        self.assertIsNone(decode_node(bytes([b[0], b[1] & 0xFE, b[2], b[3], b[4]])))

    def test_bin_scan_same_as_rplidar_ros(self):
        """rplidar_ros と同じ向き: ROS の角度 = π − 生の角度（生 180° → 0°, 生 90° → +90°, 生 270° → −90°）"""
        r = bin_scan([180.0, 90.0, 270.0], [1000, 2000, 3000], [15, 15, 15], 360, 1, 0.1, 8.0)
        inc = 2 * math.pi / 360

        def at(deg):
            return r[int(round((math.radians(deg) + math.pi) / inc)) % 360]
        self.assertAlmostEqual(at(0), 1.0)
        self.assertAlmostEqual(at(90), 2.0)
        self.assertAlmostEqual(at(-90), 3.0)
        self.assertEqual(int(np.isfinite(r).sum()), 3)


class TestSafety(unittest.TestCase):
    def setUp(self):
        self.g = SafetyGuard(guard_cfg())
        self.now = 1000.0

    def ev(self, steer, thr, pts, cmd_age=0.0, scan_age=0.0, moving=None):
        return self.g.evaluate(self.now, steer, thr, self.now - cmd_age, pts, self.now - scan_age, last_cmd_moving=moving)

    def test_clear_hold_slow(self):
        self.assertEqual(self.ev(0.0, 0.3, np.array([[3.0, 0.0]])).state, CLEAR)
        r = self.ev(0.0, 0.3, np.array([[0.45, 0.0]]))
        self.assertEqual((r.state, r.throttle), (HOLD, 0.0))
        r = self.ev(0.0, 0.3, np.array([[0.85, 0.0]]))
        self.assertEqual(r.state, SLOW)
        self.assertLess(r.throttle, 0.3)
        self.assertEqual(self.ev(0.0, 0.3, np.array([[-0.3, 0.0]])).state, CLEAR)    # 後ろは関係ない
        self.assertEqual(self.ev(0.0, -0.3, np.array([[-0.4, 0.0]])).state, HOLD)    # 後退なら止まる

    def test_steering_corridor(self):
        side = np.array([[0.5, 0.35]])
        self.assertEqual(self.ev(0.0, 0.3, side).state, CLEAR)
        left = self.ev(1.0, 0.3, side)
        self.assertIn(left.state, (HOLD, SLOW))

    def test_blocked_escalation(self):
        pts = np.array([[0.4, 0.0]])
        self.assertEqual(self.ev(0.0, 0.3, pts).state, HOLD)
        self.now += 16.0
        r = self.ev(0.0, 0.3, pts)
        self.assertEqual(r.state, BLOCKED)
        self.assertEqual(r.events[0]["code"], "BLOCKED")
        self.now += 0.1
        self.assertEqual(self.ev(0.0, 0.3, pts).events, [])

    def test_comm_lost_only_when_moving(self):
        pts = np.array([[3.0, 0.0]])
        # Nav2 がゴールで速度0を送ってから黙った → 正常（COMM_LOST にしない）
        r = self.ev(0.0, 0.0, pts, cmd_age=0.7, moving=False)
        self.assertEqual(r.state, NO_COMMAND)
        self.assertEqual(r.events, [])
        # 走れ、のまま途切れた → COMM_LOST
        g2 = SafetyGuard(guard_cfg())
        r = g2.evaluate(self.now, 0.0, 0.3, self.now - 0.7, pts, self.now, last_cmd_moving=True)
        self.assertEqual(r.events[0]["code"], "COMM_LOST")

    def test_lidar_and_estop(self):
        self.assertEqual(self.ev(0.0, 0.3, None).state, NO_LIDAR)
        self.g.latch_estop("WEB_ESTOP", "test")
        r = self.ev(0.5, 0.3, np.array([[3.0, 0.0]]))
        self.assertEqual((r.state, r.throttle, r.steer), (ESTOP, 0.0, 0.0))
        self.g.clear_estop()
        self.assertEqual(self.ev(0.0, 0.3, np.array([[3.0, 0.0]])).state, CLEAR)


class TestDriveModel(unittest.TestCase):
    def setUp(self):
        self.sm = SpeedModel({"deadband": 0.06, "gain_mps": 2.4, "min_speed": 0.12})
        self.conv = CmdVelConverter({"wheelbase": 0.257, "max_steer_deg": 25.0}, self.sm)

    def test_speed_inverse(self):
        for v in (0.15, 0.3, 0.6, -0.3):
            self.assertAlmostEqual(self.sm.thr_to_speed(self.sm.speed_to_thr(v)), v, places=6)
        self.assertAlmostEqual(self.sm.thr_to_speed(self.sm.speed_to_thr(0.05)), 0.12, places=6)  # 遅すぎは引き上げ

    def test_twist_to_steer(self):
        steer, thr = self.conv.convert(0.4, 0.0)
        self.assertAlmostEqual(steer, 0.0)
        self.assertGreater(thr, 0.0)
        # 半径 1m で左へ: ω = v / R
        steer, _ = self.conv.convert(0.4, 0.4)
        self.assertAlmostEqual(steer * math.radians(25.0), math.atan(0.257 / 1.0), places=6)
        # 後退しながら反時計回り → 舵は右（負）
        steer, thr = self.conv.convert(-0.3, 0.3)
        self.assertLess(steer, 0.0)
        self.assertLess(thr, 0.0)
        # その場旋回の指令 → ハンドルだけ切って止まる
        steer, thr = self.conv.convert(0.0, 1.0)
        self.assertEqual((steer, thr), (1.0, 0.0))
        # 曲がれる限界を超える → 1.0 で頭打ち
        self.assertEqual(self.conv.convert(0.2, 5.0)[0], 1.0)

    def test_odometry_straight_and_turn(self):
        odo = WheelOdometry({"wheelbase": 0.257, "max_steer_deg": 25.0}, self.sm, tau_s=0.0)
        thr = self.sm.speed_to_thr(0.5)
        for k in range(41):  # 2 秒（20Hz）
            odo.update({"ms": k * 50, "thr": thr, "steer": 0.0, "yaw_deg": 0.0, "imu_ok": True, "enc": -1}, k * 0.05)
        self.assertAlmostEqual(odo.state.x, 1.0, places=2)
        self.assertAlmostEqual(odo.state.y, 0.0, places=6)
        # IMU で 90 度回った分が向きに入る
        odo.reset()
        for k in range(21):
            odo.update({"ms": k * 50, "thr": thr, "steer": 0.5, "yaw_deg": 4.5 * k, "imu_ok": True, "enc": -1}, k * 0.05)
        self.assertAlmostEqual(math.degrees(odo.state.yaw), 90.0, places=4)
        self.assertGreater(odo.state.y, 0.2)
        # 間が空きすぎたら積算しない
        self.assertFalse(odo.update({"ms": 99999, "thr": thr, "steer": 0.0, "yaw_deg": 90.0}, 99.0))


class TestRobotCore(unittest.TestCase):
    def make(self, **over):
        return RobotCore(deep_merge(ROBOT_DEFAULTS, over))

    def test_drive_and_timeout(self):
        core = self.make()
        now = 100.0
        core.set_scan([math.inf] * 360, -math.pi, 2 * math.pi / 360, now)
        core.set_cmd_vel(0.4, 0.0, now)
        d = core.step(now + 0.05)
        self.assertEqual(d.kind, "drive")
        self.assertGreater(d.throttle, 0.0)
        # Nav2 が止まれ (0) を送って黙る → stop、COMM_LOST なし
        core.set_cmd_vel(0.0, 0.0, now + 0.1)
        core.set_scan([math.inf] * 360, -math.pi, 2 * math.pi / 360, now + 0.6)
        d = core.step(now + 0.7)
        self.assertEqual((d.kind, d.events), ("stop", []))

    def test_obstacle_in_front_stops(self):
        core = self.make()
        now = 10.0
        ranges = [math.inf] * 360
        ranges[180] = 0.35   # laser の 0 rad（= 前、yaw_deg 0）に 0.35m
        pts = core.set_scan(ranges, -math.pi, 2 * math.pi / 360, now)
        self.assertAlmostEqual(pts[0][0], 0.05 + 0.35, places=6)
        core.set_cmd_vel(0.4, 0.0, now)
        self.assertEqual(core.step(now).result.state, HOLD)

    def test_laser_yaw_mount(self):
        pts = scan_to_points([1.0], 0.0, 0.0, (0.0, 0.0, math.pi), 0.1, 8.0)   # 逆向きに付けた LiDAR の正面 = 車の後ろ
        self.assertAlmostEqual(pts[0][0], -1.0, places=6)


class TestSim(unittest.TestCase):
    def test_scan_sees_wall(self):
        w = SimWorld(str(MAP), start=(-4.0, -4.0, 0.0), seed=3)
        r, amin, inc = w.laser_scan((0.05, 0.0, 0.0), beams=360, noise=0.0, dropout=0.0)
        # 右 (-90°) の外壁（y = -5 の太さ 3px）→ 車の中心から 約 0.85m
        right = r[int(round((-math.pi / 2 - amin) / inc))]
        self.assertTrue(0.7 < right < 1.0, right)
        # 前方 (0°) の壁は遠い
        self.assertGreater(r[int(round((0 - amin) / inc))], 2.0)

    def test_drive_forward(self):
        w = SimWorld(str(MAP), start=(-4.0, -4.0, 0.0), seed=3)
        w.set_command(0.0, 0.3)
        for _ in range(100):
            w.step(0.02)
        x, y, th = w.pose()
        self.assertGreater(x, -3.8)
        self.assertAlmostEqual(y, -4.0, places=1)


@unittest.skipUnless(sys.platform.startswith("linux"), "疑似端末(pty)を使うので Linux のみ")
class TestSerialDevicesWithPty(unittest.TestCase):
    """本物の代わりに疑似端末で ESP32 / LiDAR のふりをして、通信処理を確かめる。"""

    def test_esp32_link(self):
        import pty

        from agv_main.esp32_link import Esp32Link

        master, slave = pty.openpty()
        got_t, got_a = [], []
        link = Esp32Link(os.ttyname(slave), on_telemetry=got_t.append, on_alert=lambda c, t: got_a.append(c))
        link.start()
        t0 = time.time()
        while link.ser is None and time.time() - t0 < 3:
            time.sleep(0.05)
        time.sleep(0.1)
        body = "T,10,1234,0,7600,-1,-1,24,0,0,1"
        boot = f"$A,BOOT,1.0.0*{protocol.checksum('A,BOOT,1.0.0')}\n"
        os.write(master, f"noise\n{boot}${body}*{protocol.checksum(body)}\n".encode())
        time.sleep(0.5)
        link.send_drive(5, 0.5, -0.25)
        time.sleep(0.2)
        written = os.read(master, 4096).decode()
        link.stop()
        self.assertIn("BOOT", got_a)
        self.assertAlmostEqual(got_t[-1]["yaw_deg"], 12.34)
        self.assertIn("$D,5,500,-250*", written)


if __name__ == "__main__":
    unittest.main()
