"""mission（タスクの進め方）のテスト。Nav2 の代わりに「言われた通りに動くふりをする」偽物を使う。

    cd edge_ai/ros2_ws/src/agv_navigation
    python3 -m pytest test -q        （agv_main も同じワークスペースにあること）
"""
from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT.parent / "agv_main"))

from agv_navigation import check_waypoints  # noqa: E402
from agv_navigation.mission import (CHARGING, ERROR, IDLE, NAV_ACTIVE, NAV_CANCELED, NAV_FAILED, NAV_PENDING,  # noqa: E402
                                    NAV_SUCCEEDED, OFFLINE, RUNNING, MissionLogic)
from agv_navigation.waypoints import Pose2D, WaypointBook, parse_pose  # noqa: E402

WAYPOINTS = ROOT / "config" / "waypoints.yaml"
CFG = {
    "tasks": {"wait_mode": "timer", "load_wait_s": 1.0, "unload_wait_s": 1.0, "return_home_after_task": False,
              "home_waypoint": "Home", "progress_publish_s": 2.0},
    "nav": {"retries": 1, "retry_delay_s": 1.0, "blocked_report_s": 15.0, "fail_after_blocked_s": 60.0},
}


class FakeNav:
    def __init__(self):
        self.state = "IDLE"
        self.distance_remaining = None
        self.goals = []
        self.cancels = 0

    def go(self, pose, name=""):
        self.goals.append((pose, name))
        self.state = NAV_PENDING
        self.distance_remaining = None

    def cancel(self):
        self.cancels += 1
        if self.state in (NAV_PENDING, NAV_ACTIVE):
            self.state = NAV_CANCELED


class TestMission(unittest.TestCase):
    def setUp(self):
        self.wps = WaypointBook(WAYPOINTS)
        self.nav = FakeNav()
        self.tasks, self.events = [], []
        self.m = MissionLogic(CFG, self.wps, self.nav, self.tasks.append, self.events.append)
        self.m.online = True
        self.m.pose = Pose2D(-4.0, -4.0, 0.0)
        self.t = 1000.0

    def tick(self, dt=0.1, n=1):
        for _ in range(n):
            self.t += dt
            self.m.tick(self.t)

    def arrive(self):
        self.nav.state = NAV_ACTIVE
        self.nav.distance_remaining = 3.0
        self.tick()
        self.nav.state = NAV_SUCCEEDED
        self.tick()

    def test_waypoints(self):
        self.assertIsNotNone(self.wps.find("dock-a"))
        self.assertEqual(self.wps.find("1").name, "Station-1")
        p = parse_pose("1.5,-2.0,90", self.wps)
        self.assertAlmostEqual(p.theta, math.pi / 2)

    def test_full_task(self):
        self.m.handle_command({"type": "TASK_ASSIGN", "taskId": "t1", "taskTitle": "テスト",
                               "startLocation": "Dock-A", "targetLocation": "Station-1"}, self.t)
        self.tick()
        self.assertEqual(self.tasks[-1]["phase"], "TO_START")
        self.tick()
        self.assertEqual(self.nav.goals[-1][1], "Dock-A")
        self.assertEqual(self.m.status(), RUNNING)
        self.arrive()
        self.assertEqual(self.tasks[-1]["phase"], "LOADING")
        self.tick(0.5, 3)                      # 1 秒待ち
        self.assertEqual(self.tasks[-1]["phase"], "TO_TARGET")
        self.tick()
        self.assertEqual(self.nav.goals[-1][1], "Station-1")
        self.arrive()
        self.tick(0.5, 3)
        self.assertEqual(self.tasks[-1]["status"], "COMPLETED")
        self.assertEqual(self.tasks[-1]["progress"], 100)
        self.m.pose = Pose2D(-4.0, -4.0, 0.0)
        self.assertEqual(self.m.status(), CHARGING)   # Home は充電器
        self.m.pose = Pose2D(0.0, 0.0, 0.0)
        self.assertEqual(self.m.status(), IDLE)

    def test_estop_cancels_and_resumes(self):
        self.m.handle_command({"type": "GOTO", "target": "Station-2"}, self.t)
        self.tick(n=2)
        self.nav.state = NAV_ACTIVE
        self.m.handle_command({"action": "EMERGENCY_STOP"}, self.t)
        self.assertEqual(self.nav.cancels, 1)
        self.tick(n=3)
        self.assertEqual(len(self.nav.goals), 1)        # 止まっている間はゴールを出さない
        self.assertEqual(self.m.status(), ERROR)
        self.m.handle_command({"action": "CLEAR_EMERGENCY"}, self.t)
        self.tick()
        self.assertEqual(len(self.nav.goals), 2)        # 同じ地点へ出し直す
        self.assertEqual(self.nav.goals[-1][1], "Station-2")

    def test_retry_then_fail(self):
        self.m.handle_command({"type": "TASK_ASSIGN", "taskId": "t2", "targetLocation": "Station-3"}, self.t)
        self.tick(n=2)
        self.nav.state = NAV_FAILED
        self.tick()                                     # 1 回目の失敗 → 1 秒後にやり直し
        self.tick(0.5, 3)
        self.assertEqual(len(self.nav.goals), 2)
        self.nav.state = NAV_FAILED
        self.tick()
        self.assertEqual(self.tasks[-1]["status"], "FAILED")

    def test_blocked(self):
        self.m.handle_command({"type": "GOTO", "target": "Station-3"}, self.t)
        self.tick(n=2)
        self.nav.state = NAV_ACTIVE
        self.nav.distance_remaining = 5.0
        self.tick()
        self.tick(1.0, 16)                              # 16 秒進まない
        self.assertEqual(self.events[-1]["code"], "BLOCKED")
        self.assertEqual(self.m.status(), ERROR)
        self.nav.distance_remaining = 4.0               # 進んだら解除
        self.tick()
        self.assertNotEqual(self.m.status(), ERROR)

    def test_offline_and_lost_hold(self):
        self.m.handle_command({"type": "GOTO", "target": "A13"}, self.t)
        self.m.online = False
        self.tick(n=3)
        self.assertEqual(self.nav.goals, [])
        self.assertEqual(self.m.status(), OFFLINE)
        self.m.online = True
        self.m.lost = True
        self.tick(n=2)
        self.assertEqual(self.nav.goals, [])
        self.m.lost = False
        self.tick()
        self.assertEqual(len(self.nav.goals), 1)

    def test_goto_xy_heading_from_current(self):
        self.m.handle_command({"type": "GOTO", "x": -4.0, "y": 0.0}, self.t)
        self.tick(n=2)
        goal = self.nav.goals[-1][0]
        self.assertAlmostEqual(goal.theta, math.pi / 2, places=6)   # 今いる (-4,-4) から真上へ

    def test_cancel_and_duplicate(self):
        msg = {"type": "TASK_ASSIGN", "taskId": "t3", "targetLocation": "Dock-B"}
        self.m.handle_command(msg, self.t)
        self.m.handle_command(msg, self.t)              # 二重に届いても1件
        self.tick(n=2)
        self.assertEqual(len(self.m.tasks.queue), 0)
        self.m.handle_command({"action": "CANCEL_TASK"}, self.t)
        self.assertEqual(self.tasks[-1]["status"], "CANCELLED")
        self.assertGreaterEqual(self.nav.cancels, 1)

    def test_unknown_location(self):
        self.m.handle_command({"type": "TASK_ASSIGN", "taskId": "t4", "targetLocation": "どこか"}, self.t)
        self.assertEqual(self.tasks[-1]["status"], "FAILED")

    def test_set_pose_returns_action(self):
        todo = self.m.handle_command({"action": "SET_POSE", "x": 1.0, "y": 2.0, "theta": 0.5}, self.t)
        self.assertAlmostEqual(todo["set_pose"].y, 2.0)
        self.assertTrue(self.m.handle_command({"action": "GLOBAL_LOCALIZE"}, self.t)["global_localize"])


class TestCheckWaypoints(unittest.TestCase):
    def test_demo_map_ok(self):
        self.assertEqual(check_waypoints.main(["--map", str(ROOT / "maps" / "demo_map.yaml"),
                                               "--waypoints", str(WAYPOINTS)]), 0)


if __name__ == "__main__":
    unittest.main()
