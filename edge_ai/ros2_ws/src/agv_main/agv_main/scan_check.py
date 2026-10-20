"""LiDAR の取り付け向きを確かめる道具（robot.yaml の laser.yaw_deg を決める）。

    ros2 run agv_main scan_check --ros-args --params-file <robot.yaml>

1. LiDAR を動かしておく（robot.launch.py か、rplidar_ros だけでも可）
2. 車体の真正面 30〜50cm に箱を置く
3. 「車体から見た角度」が 0° 付近になるように laser.yaw_deg を直す（表示される「おすすめの値」を書けばよい）
4. 箱を左に置くと +、右に置くと − の角度になれば OK（逆なら LiDAR が上下逆さま）
"""
from __future__ import annotations

import math

import numpy as np
import rclpy
from rclpy.node import Node
from sensor_msgs.msg import LaserScan

from .ros_utils import SENSOR, declare_tree

DEFAULTS = {"laser": {"x": 0.05, "y": 0.0, "yaw_deg": 0.0}, "check_range": 1.0}


class ScanCheck(Node):
    def __init__(self):
        super().__init__("scan_check")
        self.cfg = declare_tree(self, DEFAULTS)
        self.create_subscription(LaserScan, "scan", self._on_scan, SENSOR)
        self.n = 0

    def _on_scan(self, m: LaserScan) -> None:
        self.n += 1
        if self.n % 3:
            return
        r = np.asarray(m.ranges, dtype=np.float64)
        a = m.angle_min + m.angle_increment * np.arange(len(r))
        ok = np.isfinite(r) & (r > max(0.05, m.range_min)) & (r < float(self.cfg["check_range"]))
        if not ok.any():
            print(f"{self.cfg['check_range']} m 以内に何もありません（点の数 {len(r)}）")
            return
        i = int(np.argmin(np.where(ok, r, np.inf)))
        lz = self.cfg["laser"]
        yaw = math.radians(float(lz["yaw_deg"]))
        px = float(lz["x"]) + r[i] * math.cos(a[i] + yaw)
        py = float(lz["y"]) + r[i] * math.sin(a[i] + yaw)
        base_deg = math.degrees(math.atan2(py, px))
        suggest = (float(lz["yaw_deg"]) - base_deg + 180.0) % 360.0 - 180.0
        print(f"一番近い点: {r[i]:.2f} m   LiDAR 座標の角度 {math.degrees(a[i]):7.1f}°   "
              f"車体から見た角度 {base_deg:7.1f}°   "
              f"（真正面に置いているなら laser.yaw_deg のおすすめ: {suggest:.0f}）")


def main(args=None):
    rclpy.init(args=args)
    node = ScanCheck()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
