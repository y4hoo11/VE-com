"""ラズパイ（車両）側をまとめて起動する。

    ros2 launch agv_main robot.launch.py                       # 実機（ESP32 + RPLIDAR + カメラ）
    ros2 launch agv_main robot.launch.py lidar_driver:=builtin # rplidar_ros の代わりに自前ドライバ
    ros2 launch agv_main robot.launch.py camera:=false
    ros2 launch agv_main robot.launch.py use_sim:=true         # 実機の代わりにシミュレーターの車

起動するもの:
  serial_bridge          … /cmd_vel → ESP32、/odom・TF odom→base_link、安全ガード、
                           静的 TF base_link→laser / camera_link / camera_optical_frame（robot.yaml の laser / camera_mount）
  rplidar_ros (or lidar_node) … /scan
  camera_node            … camera/image_raw/compressed
"""
import os

import yaml
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, OpaqueFunction
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node

TF_REMAP = [("/tf", "tf"), ("/tf_static", "tf_static")]


def _load_params(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    for key in ("/**", "**"):
        if key in data:
            return data[key].get("ros__parameters", {})
    return {}


def _setup(context, *args, **kwargs):
    share = get_package_share_directory("agv_main")
    cfg_path = LaunchConfiguration("config").perform(context) or os.path.join(share, "config", "robot.yaml")
    ns = LaunchConfiguration("namespace").perform(context)
    use_sim = LaunchConfiguration("use_sim").perform(context).lower() in ("1", "true", "yes")
    lidar_driver = LaunchConfiguration("lidar_driver").perform(context)
    camera = LaunchConfiguration("camera").perform(context).lower() in ("1", "true", "yes")
    agv_id = LaunchConfiguration("agv_id").perform(context)
    sim_map = LaunchConfiguration("sim_map").perform(context)
    sim_obstacles = LaunchConfiguration("sim_obstacles").perform(context)

    p = _load_params(cfg_path)
    laser_f = p.get("frames", {}).get("laser", "laser")

    overrides = {}
    if agv_id:
        overrides["agv_id"] = agv_id
    calib = (p.get("camera", {}) or {}).get("calib_file") or os.path.join(share, "config", "camera_calib.yaml")
    overrides["camera.calib_file"] = calib
    params = [cfg_path, overrides]

    actions = []

    if use_sim:
        sim = dict(overrides)
        if sim_map:
            sim["sim.map"] = sim_map
        if sim_obstacles:
            sim["sim.obstacles"] = sim_obstacles
        actions.append(Node(package="agv_main", executable="sim_robot", name="sim_robot", namespace=ns,
                            parameters=[cfg_path, sim], remappings=TF_REMAP, output="screen"))
        return actions

    actions.append(Node(package="agv_main", executable="serial_bridge", name="serial_bridge", namespace=ns,
                        parameters=params, remappings=TF_REMAP, output="screen", respawn=True, respawn_delay=2.0))

    if lidar_driver == "rplidar_ros":
        actions.append(Node(
            package="rplidar_ros", executable=LaunchConfiguration("rplidar_executable").perform(context),
            name="rplidar", namespace=ns, output="screen", respawn=True, respawn_delay=2.0,
            parameters=[{
                "serial_port": LaunchConfiguration("lidar_port").perform(context),
                "serial_baudrate": 115200,          # A1 は 115200
                "frame_id": laser_f,
                "inverted": False,
                "angle_compensate": True,
            }]))
    elif lidar_driver == "builtin":
        actions.append(Node(package="agv_main", executable="lidar_node", name="lidar_node", namespace=ns,
                            parameters=params, output="screen", respawn=True, respawn_delay=2.0))

    if camera:
        actions.append(Node(package="agv_main", executable="camera_node", name="camera_node", namespace=ns,
                            parameters=params, output="screen", respawn=True, respawn_delay=3.0))
    return actions


def generate_launch_description():
    return LaunchDescription([
        DeclareLaunchArgument("config", default_value="", description="robot.yaml のパス（空なら agv_main の config/robot.yaml）"),
        DeclareLaunchArgument("namespace", default_value="", description="複数台にするときの名前空間（例 agv1）"),
        DeclareLaunchArgument("agv_id", default_value="", description="車両 ID（空なら robot.yaml の agv_id）"),
        DeclareLaunchArgument("use_sim", default_value="false", description="true で実機の代わりにシミュレーターの車"),
        DeclareLaunchArgument("lidar_driver", default_value="rplidar_ros", description="rplidar_ros / builtin / none"),
        DeclareLaunchArgument("lidar_port", default_value="/dev/ttyUSB0", description="rplidar_ros のシリアルポート"),
        DeclareLaunchArgument("rplidar_executable", default_value="rplidar_node",
                              description="rplidar_ros の実行ファイル名（古い版は rplidar_composition）"),
        DeclareLaunchArgument("camera", default_value="true"),
        DeclareLaunchArgument("sim_map", default_value=""),
        DeclareLaunchArgument("sim_obstacles", default_value="", description='例 "-2.0,-3.0,0.25; 1.0,0.0,0.2"'),
        OpaqueFunction(function=_setup),
    ])
