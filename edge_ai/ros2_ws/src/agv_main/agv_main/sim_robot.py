"""シミュレーターの車（実機のラズパイ + ESP32 + LiDAR の代わり）。

    ros2 launch agv_navigation sim.launch.py          ← Nav2 や RViz と一緒にまとめて起動（ふつうはこちら）
    ros2 run agv_main sim_robot --ros-args -p sim.obstacles:="-2.0,-3.0,0.25"

serial_bridge と同じ判断部（RobotCore: 指令の変換・安全ガード・オドメトリ）をそのまま使い、
ESP32 と LiDAR だけを仮想の部品に差し替えている。Nav2 から見ると本物の車と同じトピックが出る。
Gazebo（TurtleBot3）より軽く、TT-02 と同じ「その場で回れない車」の動きになる。

追加で出すもの:
  scan          sensor_msgs/LaserScan  仮想 LiDAR（frame: laser）
  sim/truth     geometry_msgs/PoseStamped  本当の位置（map 座標）。自己位置推定のずれの確認用
"""
from __future__ import annotations

import os

import rclpy
from geometry_msgs.msg import PoseStamped
from sensor_msgs.msg import LaserScan
from std_msgs.msg import String

from .robot_node_base import RobotBridgeBase
from .ros_utils import SENSOR, json_msg, set_quat
from .sim_world import SimEsp32, SimWorld

SIM_DEFAULTS = {
    "sim": {
        "map": "",                       # 空なら agv_navigation の maps/demo_map.yaml
        "start": [-4.0, -4.0, 0.0],      # 置く場所 [x, y, 向き(度)]（waypoints の Home と同じ）
        "obstacles": "",                 # 地図に無い障害物 "x,y,半径; x,y,半径"（人や箱のつもり）
        "lidar_hz": 5.5,
        "beams": 360,
        "publish_truth": True,
        "truth_frame": "map",
        "seed": 1,
    }
}


def parse_obstacles(text: str) -> list[tuple[float, float, float]]:
    out = []
    for part in str(text or "").replace("|", ";").split(";"):
        nums = [p for p in part.replace(" ", "").split(",") if p]
        if len(nums) >= 2:
            out.append((float(nums[0]), float(nums[1]), float(nums[2]) if len(nums) > 2 else 0.25))
    return out


def default_map_path() -> str:
    try:
        from ament_index_python.packages import get_package_share_directory
        return os.path.join(get_package_share_directory("agv_navigation"), "maps", "demo_map.yaml")
    except Exception:
        return ""


class SimRobot(RobotBridgeBase):
    def __init__(self):
        super().__init__("sim_robot", SIM_DEFAULTS)
        sc = self.cfg["sim"]
        self.pub_scan = self.create_publisher(LaserScan, "scan", SENSOR)
        self.pub_truth = self.create_publisher(PoseStamped, "sim/truth", 10)
        self.pub_sim = self.create_publisher(String, "sim/status", 5)
        self.create_timer(1.0 / float(sc["lidar_hz"]), self._scan_tick)
        if bool(sc["publish_truth"]):
            self.create_timer(0.1, self._truth_tick)
        self.create_timer(1.0, self._sim_status_tick)

    def make_esp(self):
        sc = self.cfg["sim"]
        veh = self.cfg["vehicle"]
        path = str(sc["map"]) or default_map_path()
        if not path:
            raise RuntimeError("シミュレーター用の地図がありません（sim.map を指定してください）")
        start = [float(v) for v in sc["start"]]
        self.world = SimWorld(path, start=start, obstacles=parse_obstacles(sc["obstacles"]),
                              wheelbase=float(veh["wheelbase"]), max_steer_deg=float(veh["max_steer_deg"]),
                              length=float(veh["length"]), width=float(veh["width"]), seed=int(sc["seed"]))
        self.get_logger().info(f"シミュレーター: 地図 {path}, 初期位置 {start}, 障害物 {self.world.obstacles}")
        return SimEsp32(self.world)

    def _scan_tick(self) -> None:
        sc = self.cfg["sim"]
        mount = self.core.laser_mount
        ranges, amin, inc = self.world.laser_scan(mount, beams=int(sc["beams"]), max_range=float(self.cfg["laser"]["max_range"]))
        m = LaserScan()
        m.header.stamp = self.get_clock().now().to_msg()
        m.header.frame_id = self.frames["laser"]
        m.angle_min = float(amin)
        m.angle_increment = float(inc)
        m.angle_max = float(amin + inc * (len(ranges) - 1))
        m.scan_time = 1.0 / float(sc["lidar_hz"])
        m.time_increment = m.scan_time / len(ranges)
        m.range_min = 0.15
        m.range_max = float(self.cfg["laser"]["max_range"])
        m.ranges = [float(r) for r in ranges]
        self.pub_scan.publish(m)

    def _truth_tick(self) -> None:
        x, y, th = self.world.pose()
        p = PoseStamped()
        p.header.stamp = self.get_clock().now().to_msg()
        p.header.frame_id = str(self.cfg["sim"]["truth_frame"])
        p.pose.position.x = x
        p.pose.position.y = y
        set_quat(p.pose.orientation, th)
        self.pub_truth.publish(p)

    def _sim_status_tick(self) -> None:
        self.pub_sim.publish(json_msg({"collisions": self.world.collisions, "collided": self.world.collided}))


def main(args=None):
    rclpy.init(args=args)
    node = SimRobot()
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
