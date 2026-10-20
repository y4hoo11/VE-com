"""シミュレーターで全部を1台の PC（ve_con_ros2 コンテナ）で動かす。実機もラズパイも要らない。

    ros2 launch agv_navigation sim.launch.py
    ros2 launch agv_navigation sim.launch.py obstacles:="-2.0,-3.0,0.25"     # 地図に無い障害物を置く
    ros2 launch agv_navigation sim.launch.py use_mqtt:=false                 # Web につながない

起動するもの:
  sim_robot（agv_main）… 仮想の TT-02・ESP32・LiDAR（serial_bridge と同じ判断部を使う）
  navigation.launch.py … Nav2・mission_manager・mqtt_bridge・RViz（カメラが無いので marker_localizer は無効）

RViz での操作は docs/ros2_quickstart.md の手順6と同じ（Nav2 Goal でゴールを置く）。
Web からのタスク（MQTT）でも動く: ros2 run agv_navigation send_task task Dock-A Station-1
"""
import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration


def generate_launch_description():
    nav_share = get_package_share_directory("agv_navigation")
    main_share = get_package_share_directory("agv_main")
    map_default = os.path.join(nav_share, "maps", "demo_map.yaml")
    return LaunchDescription([
        DeclareLaunchArgument("map", default_value=map_default),
        DeclareLaunchArgument("obstacles", default_value="", description='地図に無い障害物 "x,y,半径; ..."'),
        DeclareLaunchArgument("use_rviz", default_value="true"),
        DeclareLaunchArgument("use_mqtt", default_value="true"),
        DeclareLaunchArgument("agv_id", default_value=""),
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(os.path.join(main_share, "launch", "robot.launch.py")),
            launch_arguments={
                "use_sim": "true",
                "sim_map": LaunchConfiguration("map"),
                "sim_obstacles": LaunchConfiguration("obstacles"),
                "agv_id": LaunchConfiguration("agv_id"),
            }.items()),
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(os.path.join(nav_share, "launch", "navigation.launch.py")),
            launch_arguments={
                "map": LaunchConfiguration("map"),
                "use_rviz": LaunchConfiguration("use_rviz"),
                "use_mqtt": LaunchConfiguration("use_mqtt"),
                "use_vision": "false",
                "agv_id": LaunchConfiguration("agv_id"),
            }.items()),
    ])
