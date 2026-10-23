"""ArUco マーカーからの位置計算のテスト（ROS もカメラもいらない。画像は合成する）。

    cd edge_ai/ros2_ws/src/agv_vision
    python3 -m pytest test -q
"""
from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from agv_vision.aruco_core import (ArucoLocalizer, Pose2D, T_from_tf, camera_mount_T, load_markers,  # noqa: E402
                                   marker_image, wrap_angle)

MARKERS = ROOT / "config" / "markers.yaml"
CALIB = ROOT.parent / "agv_main" / "config" / "camera_calib.yaml"
MOUNT = {"x": 0.18, "y": 0.0, "z": 0.15, "pitch_deg": 15.0, "yaw_deg": 0.0}
VISION = {"aruco_dict": "DICT_4X4_50", "marker_size": 0.15, "max_marker_distance": 2.5, "min_size_px": 60.0}


def rpy_to_quat(roll, pitch, yaw):
    """static_transform_publisher と同じ（固定軸 X→Y→Z = Rz·Ry·Rx）"""
    cr, sr = math.cos(roll / 2), math.sin(roll / 2)
    cp, sp = math.cos(pitch / 2), math.sin(pitch / 2)
    cy, sy = math.cos(yaw / 2), math.sin(yaw / 2)
    return (sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy, cr * cp * cy + sr * sp * sy)


class TestAruco(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.markers = load_markers(MARKERS)
        cls.loc = ArucoLocalizer(VISION, MOUNT, str(CALIB), cls.markers)

    def render(self, mid, truth):
        loc = self.loc
        pts = loc.project_marker(mid, truth)
        img = np.full((480, 640, 3), 200, np.uint8)
        mk = marker_image(loc.dictionary, mid, 200)
        mk = cv2.copyMakeBorder(mk, 40, 40, 40, 40, cv2.BORDER_CONSTANT, value=255)
        src = np.float32([[40, 40], [240, 40], [240, 240], [40, 240]])
        H = cv2.getPerspectiveTransform(src, np.float32(pts))
        warp = cv2.warpPerspective(cv2.cvtColor(mk, cv2.COLOR_GRAY2BGR), H, (640, 480))
        mask = cv2.warpPerspective(np.full(mk.shape, 255, np.uint8), H, (640, 480))
        img[mask > 0] = warp[mask > 0]
        return img

    def test_launch_tf_matches_mount(self):
        """robot.launch.py の static TF（base_link→camera_link→camera_optical_frame）と、
        コードが前提にしているカメラの向きが一致すること"""
        def T(x, y, z, roll, pitch, yaw):
            return T_from_tf(x, y, z, *rpy_to_quat(roll, pitch, yaw))
        T_bc = T(0.18, 0.0, 0.15, 0.0, math.radians(15.0), 0.0)
        T_co = T(0.0, 0.0, 0.0, -math.pi / 2, 0.0, -math.pi / 2)
        self.assertTrue(np.allclose(T_bc @ T_co, camera_mount_T(MOUNT), atol=1e-9))

    def test_pose_near(self):
        truth = Pose2D(0.05, -4.3, -math.pi / 2 + 0.1)
        obs = [o for o in self.loc.detect(self.render(2, truth)) if o.id == 2]
        self.assertEqual(len(obs), 1)
        self.assertTrue(obs[0].pose_reliable)
        p = obs[0].robot_pose
        self.assertLess(math.hypot(p.x - truth.x, p.y - truth.y), 0.05)
        self.assertLess(abs(wrap_angle(p.theta - truth.theta)), math.radians(3))

    def test_far_is_not_reliable(self):
        truth = Pose2D(0.1, -3.6, -math.pi / 2 + 0.15)
        obs = [o for o in self.loc.detect(self.render(2, truth)) if o.id == 2]
        self.assertEqual(len(obs), 1)
        self.assertFalse(obs[0].pose_reliable)   # 小さいので向きは信用しない（補正に使わない）
        self.assertIsNotNone(obs[0].bearing)


if __name__ == "__main__":
    unittest.main()
