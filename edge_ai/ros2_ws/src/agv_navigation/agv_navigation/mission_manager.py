"""PC1 で動かす ROS ノード: Web のタスクを Nav2 のゴールに分解して実行し、車両の状態をまとめる。

    ros2 run agv_navigation mission_manager --ros-args --params-file config/mission.yaml
    （ふつうは ros2 launch agv_navigation navigation.launch.py で Nav2 と一緒に起動）

購読:
  agv/command       String(JSON)   mqtt_bridge が Web から受けたコマンド
  emergency_stop    Bool           緊急停止の状態（ラッチ）
  agv/safety        String(JSON)   ラズパイの安全ガードの状態
  amcl_pose         PoseWithCovarianceStamped  AMCL の推定（確からしさに使う）
  odom              Odometry       車両が生きているか・速度
  TF map→base_link                 現在地
配信:
  agv/state         String(JSON)   Web 向けの状態（mqtt_bridge が agv/{id}/telemetry へ）2Hz
  agv/task_status   String(JSON)   タスクの進み具合（→ agv/{id}/task）
  agv/mission_events String(JSON)  LOCALIZATION_LOST / BLOCKED（→ agv/{id}/emergency）
  initialpose       PoseWithCovarianceStamped  起動時・SET_POSE で AMCL に現在地を教える
アクション:
  navigate_to_pose（Nav2）
"""
from __future__ import annotations

import json
import math
import os
import time
from pathlib import Path

import rclpy
from geometry_msgs.msg import PoseWithCovarianceStamped
from nav_msgs.msg import Odometry
from rclpy.node import Node
from rclpy.time import Time
from std_msgs.msg import Bool, String
from std_srvs.srv import Empty
from tf2_ros import Buffer, TransformListener

from .mission import MissionLogic
from .nav_client import Nav2Client
from .waypoints import Pose2D, WaypointBook, parse_pose

from agv_main.ros_utils import EVENTS, LATCHED, declare_tree, json_msg, parse_json, quat_to_yaw  # 同じワークスペースの小物

DEFAULTS = {
    "agv_id": "AGV-01",
    "map_id": "demo_map",
    "waypoints_file": "",                     # 空なら agv_navigation/config/waypoints.yaml
    "frames": {"map": "map", "base": "base_link"},
    "behavior_tree": "",                      # 空なら bt_navigator の既定（nav2_params.yaml）
    "tasks": {
        "wait_mode": "timer",                 # timer: 一定時間待つ / confirm: Web の CONFIRM を待つ
        "load_wait_s": 3.0,
        "unload_wait_s": 3.0,
        "return_home_after_task": False,
        "home_waypoint": "Home",
        "progress_publish_s": 2.0,
    },
    "nav": {
        "retries": 2,                         # Nav2 が失敗したときのやり直し回数
        "retry_delay_s": 3.0,
        "blocked_report_s": 15.0,             # この秒数進めなければ Web に BLOCKED
        "fail_after_blocked_s": 60.0,         # この秒数進めなければタスク失敗
    },
    "localization": {
        "initial_pose": "Home",               # 起動時の現在地（地点名 or "x,y,deg"）
        "resume_pose_max_age_s": 1800.0,      # 前回の位置をこの秒数以内に保存していれば、そこから再開
        "state_dir": "~/.ros/agv_state",
        "lost_quality": 0.25,                 # 確からしさがこれ未満で 3 秒 → 迷子扱い（停止）
        "ok_quality": 0.45,                   # 迷子からの復帰
        "initial_cov_xy": 0.15,               # initialpose の不確かさ [m]
        "initial_cov_deg": 10.0,
    },
    "publish": {"state_hz": 2.0, "offline_timeout_s": 3.0},
}


def loc_quality(cov) -> float:
    """AMCL の共分散 → 0〜1 の「確からしさ」（Web の locQuality）。"""
    sxy = math.sqrt(max(0.0, cov[0]) + max(0.0, cov[7]))
    syaw = math.sqrt(max(0.0, cov[35]))
    return 1.0 / (1.0 + (sxy / 0.20) ** 2 + (syaw / 0.35) ** 2)


class MissionManager(Node):
    def __init__(self):
        super().__init__("mission_manager")
        self.cfg = declare_tree(self, DEFAULTS)
        self.id = str(os.environ.get("AGV_ID") or self.cfg["agv_id"])
        wp_path = str(self.cfg["waypoints_file"]) or self._share_file("config", "waypoints.yaml")
        self.waypoints = WaypointBook(wp_path)
        self.get_logger().info(f"地点 {len(self.waypoints.items)} 件: {wp_path}")
        fr = self.cfg["frames"]
        self.map_frame, self.base_frame = str(fr["map"]), str(fr["base"])

        self.tf_buffer = Buffer()
        self.tf_listener = TransformListener(self.tf_buffer, self)
        self.nav = Nav2Client(self, "navigate_to_pose", self.map_frame, str(self.cfg["behavior_tree"]))
        self.pub_state = self.create_publisher(String, "agv/state", 10)
        self.pub_task = self.create_publisher(String, "agv/task_status", EVENTS)
        self.pub_event = self.create_publisher(String, "agv/mission_events", EVENTS)
        self.pub_initial = self.create_publisher(PoseWithCovarianceStamped, "initialpose", 10)
        self.global_loc = self.create_client(Empty, "reinitialize_global_localization")

        self.logic = MissionLogic(self.cfg, self.waypoints, self.nav,
                                  publish_task=lambda d: self.pub_task.publish(json_msg(d)),
                                  publish_event=self._event,
                                  log=lambda t: self.get_logger().info(t))

        self.create_subscription(String, "agv/command", self._on_command, EVENTS)
        self.create_subscription(Bool, "emergency_stop", self._on_estop, LATCHED)
        self.create_subscription(String, "agv/safety", self._on_safety, LATCHED)
        self.create_subscription(PoseWithCovarianceStamped, "amcl_pose", self._on_amcl, 10)
        self.create_subscription(Odometry, "odom", self._on_odom, 10)

        self.estop_topic = False
        self.estop_cmd = False
        self.pi_latched = False
        self.quality = 0.0
        self.amcl_seen = False
        self.last_odom = 0.0
        self.speed = 0.0
        self._low_q_since: float | None = None
        self._lost_reported = False
        self._t_state = 0.0
        self._t_save = 0.0

        lc = self.cfg["localization"]
        self.state_file = Path(os.path.expanduser(str(lc["state_dir"]))) / f"{self.id}.json"
        self._initial_pose = self._load_saved_pose()
        if self._initial_pose is not None:
            self.get_logger().info(f"前回の位置から再開します: {self.state_file}")
        else:
            self._initial_pose = parse_pose(lc["initial_pose"], self.waypoints)
        self._initial_tries = 0
        self.create_timer(1.0, self._send_initial_pose_until_amcl)
        self.create_timer(0.1, self._tick)

    def _share_file(self, *parts) -> str:
        try:
            from ament_index_python.packages import get_package_share_directory
            return os.path.join(get_package_share_directory("agv_navigation"), *parts)
        except Exception:
            return str(Path(__file__).resolve().parent.parent.joinpath(*parts))

    def _event(self, d: dict) -> None:
        self.get_logger().warn(f"通知: {d.get('code')} {d.get('reason')}")
        self.pub_event.publish(json_msg(d))

    # ------------------------------------------------------------------
    #  入力
    # ------------------------------------------------------------------
    def _on_command(self, msg: String) -> None:
        d = parse_json(msg)
        if not d:
            return
        self.get_logger().info(f"コマンド: {json.dumps(d, ensure_ascii=False)}")
        if d.get("action") == "EMERGENCY_STOP":
            self.estop_cmd = True
        elif d.get("action") == "CLEAR_EMERGENCY":
            self.estop_cmd = False
        todo = self.logic.handle_command(d)
        if "set_pose" in todo:
            self.publish_initial_pose(todo["set_pose"])
        if todo.get("global_localize"):
            self._global_localize()

    def _on_estop(self, msg: Bool) -> None:
        self.estop_topic = bool(msg.data)
        if self.estop_topic:
            self.logic.handle_command({"action": "EMERGENCY_STOP"})
        else:
            self.estop_cmd = False

    def _on_safety(self, msg: String) -> None:
        d = parse_json(msg)
        self.logic.pi_safety = str(d.get("state", ""))
        self.pi_latched = bool(d.get("latched", False))

    def _on_amcl(self, msg: PoseWithCovarianceStamped) -> None:
        self.amcl_seen = True
        self.quality = loc_quality(msg.pose.covariance)

    def _on_odom(self, msg: Odometry) -> None:
        self.last_odom = time.time()
        self.speed = float(msg.twist.twist.linear.x)

    # ------------------------------------------------------------------
    #  自己位置
    # ------------------------------------------------------------------
    def current_pose(self) -> Pose2D | None:
        try:
            t = self.tf_buffer.lookup_transform(self.map_frame, self.base_frame, Time())
        except Exception:
            return None
        tr = t.transform
        return Pose2D(tr.translation.x, tr.translation.y, quat_to_yaw(tr.rotation))

    def publish_initial_pose(self, pose: Pose2D) -> None:
        lc = self.cfg["localization"]
        m = PoseWithCovarianceStamped()
        m.header.frame_id = self.map_frame
        m.header.stamp = self.get_clock().now().to_msg()
        m.pose.pose.position.x = float(pose.x)
        m.pose.pose.position.y = float(pose.y)
        m.pose.pose.orientation.z = math.sin(pose.theta / 2.0)
        m.pose.pose.orientation.w = math.cos(pose.theta / 2.0)
        cov = [0.0] * 36
        cov[0] = cov[7] = float(lc["initial_cov_xy"]) ** 2
        cov[35] = math.radians(float(lc["initial_cov_deg"])) ** 2
        m.pose.covariance = cov
        self.pub_initial.publish(m)
        self.logic.lost = False
        self._low_q_since = None
        self._lost_reported = False
        self.get_logger().info(f"現在地を設定: ({pose.x:.2f}, {pose.y:.2f}, {math.degrees(pose.theta):.0f}°)")

    def _send_initial_pose_until_amcl(self) -> None:
        """AMCL が動き出すまで、起動時の現在地を送り続ける（AMCL は起動完了前の initialpose を無視するため）。"""
        if self._initial_pose is None or self.amcl_seen or self._initial_tries >= 60:
            return
        if self.count_subscribers("initialpose") == 0:
            return
        self._initial_tries += 1
        self.publish_initial_pose(self._initial_pose)

    def _global_localize(self) -> None:
        if not self.global_loc.service_is_ready():
            self.get_logger().warn("AMCL の reinitialize_global_localization が使えません")
            return
        self.global_loc.call_async(Empty.Request())
        self.get_logger().warn("地図全体から位置を探し直します（車を少し動かすと見つかりやすい。マーカーが見えれば自動で補正）")

    def _load_saved_pose(self) -> Pose2D | None:
        max_age = float(self.cfg["localization"]["resume_pose_max_age_s"])
        try:
            data = json.loads(self.state_file.read_text(encoding="utf-8"))
            if time.time() - float(data["time"]) > max_age:
                return None
            return Pose2D(float(data["x"]), float(data["y"]), float(data["theta"]))
        except Exception:
            return None

    def _save_pose(self, now: float, pose: Pose2D | None) -> None:
        if pose is None or now - self._t_save < 2.0 or not self.amcl_seen or self.logic.lost or not self.logic.online:
            return
        self._t_save = now
        try:
            self.state_file.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.state_file.with_suffix(".tmp")
            tmp.write_text(json.dumps({**pose.to_dict(), "time": now}), encoding="utf-8")
            tmp.replace(self.state_file)
        except Exception as e:
            self.get_logger().debug(f"位置の保存に失敗: {e}")

    def _update_lost(self, now: float) -> None:
        lc = self.cfg["localization"]
        if not self.amcl_seen:
            return
        if self.quality < float(lc["lost_quality"]):
            if self._low_q_since is None:
                self._low_q_since = now
            if now - self._low_q_since > 3.0 and not self.logic.lost:
                self.logic.lost = True
                if not self._lost_reported:
                    self._lost_reported = True
                    self._event({"code": "LOCALIZATION_LOST", "source": "pc1",
                                 "reason": "自己位置が分からなくなりました。マーカーが見える所へ動かすか、現在地を設定（SET_POSE）してください"})
        else:
            self._low_q_since = None
            if self.logic.lost and self.quality >= float(lc["ok_quality"]):
                self.get_logger().info("自己位置が戻りました")
                self.logic.lost = False
                self._lost_reported = False

    # ------------------------------------------------------------------
    #  周期処理
    # ------------------------------------------------------------------
    def _tick(self) -> None:
        now = time.time()
        pose = self.current_pose()
        lg = self.logic
        lg.pose = pose
        lg.online = self.last_odom > 0 and now - self.last_odom < float(self.cfg["publish"]["offline_timeout_s"])
        lg.estop = self.estop_topic or self.estop_cmd or self.pi_latched
        self._update_lost(now)
        self.nav.poll()
        lg.tick(now)
        self._save_pose(now, pose)
        if now - self._t_state >= 1.0 / float(self.cfg["publish"]["state_hz"]):
            self._t_state = now
            payload = lg.summary()
            payload.update({"mapId": str(self.cfg["map_id"]), "speed": round(self.speed, 2),
                            "locQuality": round(self.quality, 2)})
            if pose is not None:
                payload.update(pose.to_dict())
            self.pub_state.publish(json_msg(payload))


def main(args=None):
    rclpy.init(args=args)
    node = MissionManager()
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
