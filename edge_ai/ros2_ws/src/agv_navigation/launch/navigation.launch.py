"""PC1（メイン頭脳）側をまとめて起動する。

    ros2 launch agv_navigation navigation.launch.py
    ros2 launch agv_navigation navigation.launch.py map:=/path/to/factory.yaml use_rviz:=false

起動するもの:
  Nav2 一式（nav2_bringup の bringup_launch.py）: map_server, AMCL, planner(Smac Hybrid),
      controller(Regulated Pure Pursuit), behavior_server, bt_navigator, velocity_smoother ほか
  mission_manager  … Web のタスク → Nav2 のゴール、状態のまとめ
  mqtt_bridge      … Web(MQTT) ⇔ ROS
  marker_localizer … ArUco マーカーで自己位置を補正（use_vision:=false で無効）
  RViz             … nav2_bringup の画面設定（use_rviz:=false で無効）
"""
import os
import tempfile

import yaml
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription, OpaqueFunction
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node

TF_REMAP = [("/tf", "tf"), ("/tf_static", "tf_static")]


def _truthy(v: str) -> bool:
    return str(v).lower() in ("1", "true", "yes", "on")


def rewrite_nav2_params(src: str, map_yaml: str, bt_xml: str, use_sim_time: bool) -> str:
    """nav2_params.yaml に「地図のパス」「行動ツリーのパス」「use_sim_time」を書き足した一時ファイルを作る。"""
    with open(src, encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    def params_of(node_key: str) -> dict:
        node = data.setdefault(node_key, {})
        return node.setdefault("ros__parameters", {})

    params_of("map_server")["yaml_filename"] = map_yaml
    params_of("bt_navigator")["default_nav_to_pose_bt_xml"] = bt_xml

    def set_sim_time(d):
        if isinstance(d, dict):
            if "ros__parameters" in d and isinstance(d["ros__parameters"], dict):
                d["ros__parameters"]["use_sim_time"] = use_sim_time
            for v in d.values():
                set_sim_time(v)
    set_sim_time(data)

    fd, path = tempfile.mkstemp(prefix="agv_nav2_params_", suffix=".yaml")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False)
    return path


def _setup(context, *args, **kwargs):
    share = get_package_share_directory("agv_navigation")
    nav2_share = get_package_share_directory("nav2_bringup")
    lc = lambda name: LaunchConfiguration(name).perform(context)  # noqa: E731

    ns = lc("namespace")
    use_sim_time = _truthy(lc("use_sim_time"))
    map_yaml = lc("map") or os.path.join(share, "maps", "demo_map.yaml")
    params_src = lc("params_file") or os.path.join(share, "config", "nav2_params.yaml")
    mission_params = lc("mission_params") or os.path.join(share, "config", "mission.yaml")
    bt_xml = os.path.join(share, "behavior_trees", "navigate_ackermann.xml")
    nav2_params = rewrite_nav2_params(params_src, map_yaml, bt_xml, use_sim_time)

    overrides = {"use_sim_time": use_sim_time}
    if lc("agv_id"):
        overrides["agv_id"] = lc("agv_id")
    if lc("mqtt_host"):
        overrides["mqtt.host"] = lc("mqtt_host")

    actions = [
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(os.path.join(nav2_share, "launch", "bringup_launch.py")),
            launch_arguments={
                "namespace": ns,
                "use_namespace": "true" if ns else "false",
                "slam": "False",
                "map": map_yaml,
                "use_sim_time": "true" if use_sim_time else "false",
                "params_file": nav2_params,
                "autostart": "true",
                "use_composition": lc("use_composition"),
            }.items()),
        Node(package="agv_navigation", executable="mission_manager", name="mission_manager", namespace=ns,
             parameters=[mission_params, overrides], remappings=TF_REMAP, output="screen"),
    ]
    if _truthy(lc("use_mqtt")):
        actions.append(Node(package="agv_main", executable="mqtt_bridge", name="mqtt_bridge", namespace=ns,
                            parameters=[mission_params, overrides], output="screen", respawn=True, respawn_delay=3.0))
    if _truthy(lc("use_vision")):
        vision_share = get_package_share_directory("agv_vision")
        vision_params = lc("vision_params") or os.path.join(vision_share, "config", "vision.yaml")
        actions.append(Node(package="agv_vision", executable="marker_localizer", name="marker_localizer", namespace=ns,
                            parameters=[vision_params, overrides], remappings=TF_REMAP, output="screen",
                            respawn=True, respawn_delay=3.0))
    if _truthy(lc("use_rviz")):
        actions.append(IncludeLaunchDescription(
            PythonLaunchDescriptionSource(os.path.join(nav2_share, "launch", "rviz_launch.py")),
            launch_arguments={"namespace": ns, "use_namespace": "true" if ns else "false"}.items()))
    return actions


def generate_launch_description():
    return LaunchDescription([
        DeclareLaunchArgument("map", default_value="", description="地図の yaml（空なら agv_navigation/maps/demo_map.yaml）"),
        DeclareLaunchArgument("params_file", default_value="", description="Nav2 の設定（空なら config/nav2_params.yaml）"),
        DeclareLaunchArgument("mission_params", default_value="", description="mission_manager / mqtt_bridge の設定"),
        DeclareLaunchArgument("vision_params", default_value="", description="marker_localizer の設定"),
        DeclareLaunchArgument("namespace", default_value=""),
        DeclareLaunchArgument("agv_id", default_value=""),
        DeclareLaunchArgument("mqtt_host", default_value="", description="空なら mission.yaml の mqtt.host（または環境変数 MQTT_HOST）"),
        DeclareLaunchArgument("use_sim_time", default_value="false"),
        DeclareLaunchArgument("use_composition", default_value="True"),
        DeclareLaunchArgument("use_rviz", default_value="true"),
        DeclareLaunchArgument("use_mqtt", default_value="true"),
        DeclareLaunchArgument("use_vision", default_value="true"),
        OpaqueFunction(function=_setup),
    ])
