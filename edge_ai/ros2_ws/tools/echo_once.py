"""ROS の std_msgs/String のトピックを1回だけ受け取って、中身（data）をそのまま表示する。
edge_ai/scripts/start_all.ps1 の接続確認で使う（ros2 topic echo は長い文字列を途中で切るため）。

    python3 /workspace/ros2_ws/tools/echo_once.py /agv/robot_info 6     # 6 秒待っても来なければ何も出さない
"""
import sys
import time

import rclpy
from std_msgs.msg import String


def main() -> None:
    topic = sys.argv[1] if len(sys.argv) > 1 else "/agv/robot_info"
    wait = float(sys.argv[2]) if len(sys.argv) > 2 else 6.0
    rclpy.init()
    node = rclpy.create_node("echo_once")
    got: list[str] = []
    node.create_subscription(String, topic, lambda m: got.append(m.data), 10)
    t0 = time.time()
    while not got and time.time() - t0 < wait:
        rclpy.spin_once(node, timeout_sec=0.5)
    if got:
        print(got[0])
    node.destroy_node()
    rclpy.shutdown()


if __name__ == "__main__":
    main()
