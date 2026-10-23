"""RPLIDAR A1 の予備ドライバ（rplidar_ros が使えないとき用）。/scan (sensor_msgs/LaserScan) を出す。

ふつうは公式の rplidar_ros を使う（robot.launch.py の lidar_driver:=rplidar_ros、既定）。
こちらは pyserial だけで動く自前ドライバ（lidar_driver:=builtin）。

角度は rplidar_ros と同じ向きにそろえてある:
    ROS の角度 = π − (LiDAR の生の角度)       （生の角度は上から見て時計回り）
つまり laser 座標の +x は「生の角度 180°」の方向。取り付けの向きは robot.yaml の laser.yaw_deg で合わせる
（ros2 run agv_main scan_check で確認できる）。
"""
from __future__ import annotations

import math
import threading

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import LaserScan

from .rplidar_a1 import RPLidarA1, bin_scan
from .ros_utils import SENSOR, declare_tree

DEFAULTS = {
    "lidar": {"port": "auto", "baud": 115200, "bins": 360, "min_quality": 1},
    "frames": {"laser": "laser"},
    "laser": {"min_range": 0.12, "max_range": 8.0},
}


class LidarNode(Node):
    def __init__(self):
        super().__init__("lidar_node")
        self.cfg = declare_tree(self, DEFAULTS)
        lc = self.cfg["lidar"]
        self.pub = self.create_publisher(LaserScan, "scan", SENSOR)
        self._lock = threading.Lock()
        self.lidar = RPLidarA1(str(lc["port"]), int(lc["baud"]), on_scan=self._on_scan)
        self.lidar.start()
        self.get_logger().info("RPLIDAR A1（自前ドライバ）を起動しました")

    def _on_scan(self, angles, dists, quals) -> None:
        lc = self.cfg["lidar"]
        bins = int(lc["bins"])
        rmin, rmax = float(self.cfg["laser"]["min_range"]), float(self.cfg["laser"]["max_range"])
        ranges = bin_scan(angles, dists, quals, bins, int(lc["min_quality"]), rmin, rmax)
        m = LaserScan()
        m.header.stamp = self.get_clock().now().to_msg()
        m.header.frame_id = str(self.cfg["frames"]["laser"])
        m.angle_min = -math.pi
        m.angle_increment = 2 * math.pi / bins
        m.angle_max = m.angle_min + m.angle_increment * (bins - 1)
        hz = self.lidar.scan_hz or 5.5
        m.scan_time = 1.0 / hz
        m.time_increment = m.scan_time / bins
        m.range_min = rmin
        m.range_max = rmax
        m.ranges = ranges.tolist()
        with self._lock:
            self.pub.publish(m)

    def destroy_node(self):
        try:
            self.lidar.stop()
        except Exception:
            pass
        return super().destroy_node()


def main(args=None):
    rclpy.init(args=args)
    node = LidarNode()
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
