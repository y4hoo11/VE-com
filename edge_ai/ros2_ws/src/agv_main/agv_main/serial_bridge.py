"""ラズパイで動かす ROS ノード: Nav2 の /cmd_vel ⇔ ESP32（USB シリアル）。

    ros2 run agv_main serial_bridge --ros-args --params-file config/robot.yaml
    （通常は ros2 launch agv_main robot.launch.py で LiDAR・カメラと一緒に起動）

やること:
  - /cmd_vel（速度 v と回転 ω）を TT-02 のステア・スロットルに直して ESP32 へ送る（20Hz）
  - その前に LiDAR（/scan）で安全チェック。近ければ減速・停止（PC1 や Wi-Fi が落ちても効く）
  - ESP32 のテレメトリから /odom と TF odom→base_link を出す（AMCL・Nav2 が使う）
  - /cmd_vel が 0.5 秒来なければ停止。ESP32 自身も 0.3 秒で停止する（二重の安全）
トピックの一覧は robot_node_base.py の先頭を参照。
"""
from __future__ import annotations

import rclpy

from .esp32_link import Esp32Link
from .robot_node_base import RobotBridgeBase


class SerialBridge(RobotBridgeBase):
    def __init__(self):
        super().__init__("serial_bridge")

    def make_esp(self):
        e = self.cfg["esp32"]
        return Esp32Link(str(e["port"]), int(e["baud"]))


def main(args=None):
    rclpy.init(args=args)
    node = SerialBridge()
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
