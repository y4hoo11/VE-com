"""PC1 で動かす ROS ノード: Web のタスクを Nav2 のゴールに分解して実行し、車両の状態をまとめる。

    ros2 run agv_navigation mission_manager --ros-args --params-file config/mission.yaml
    （ふつうは ros2 launch agv_navigation navigation.launch.py で Nav2 と一緒に起動）

購読:
  agv/command       String(JSON)   mqtt_bridge が Web から受けたコマンド
  agv/map_config    String(JSON)   使う地図 {"mapId"}（ラッチ。mqtt_bridge が agv/config/map から）
  emergency_stop    Bool           緊急停止の状態（ラッチ）
  agv/safety        String(JSON)   ラズパイの安全ガードの状態
  amcl_pose         PoseWithCovarianceStamped  AMCL の推定（確からしさに使う）
  odom              Odometry       車両が生きているか・速度
  TF map→base_link                 現在地
配信:
  agv/state         String(JSON)   Web 向けの状態（mqtt_bridge が agv/{id}/telemetry へ）2Hz
  agv/task_status   String(JSON)   タスクの進み具合（→ agv/{id}/task）
  agv/mission_events String(JSON)  LOCALIZATION_LOST / BLOCKED（→ agv/{id}/emergency）
  initialpose       PoseWithCovarianceStamped  起動時・SET_POSE・地図の切り替えで AMCL に現在地を教える
  cmd_vel           Twist          手動操縦（MANUAL_DRIVE）のときだけ。タスクが無いとき = Nav2 が出していないとき
  agv/map_status    String(JSON)   地図の切り替えの結果（→ agv/{id}/map。docs/agv_protocol.md 2-9）
  sim/set_map       String(JSON)   シミュレーターの世界の地図も切り替える（sim_robot。実機では誰も受けない）
アクション / サービス:
  navigate_to_pose（Nav2）
  map_server/load_map（Nav2）     地図の切り替え（SET_MAP）で地図を読み直す
"""
from __future__ import annotations

import json
import math
import os
import time
from pathlib import Path

import rclpy
from geometry_msgs.msg import PoseWithCovarianceStamped, Twist
from nav_msgs.msg import Odometry
from rclpy.node import Node
from rclpy.time import Time
from std_msgs.msg import Bool, String
from nav2_msgs.srv import ClearEntireCostmap, LoadMap
from std_srvs.srv import Empty
from tf2_ros import Buffer, TransformListener

from .mission import MissionLogic
from .nav_client import Nav2Client
from .waypoints import Pose2D, WaypointBook, parse_pose

from agv_main.ros_utils import EVENTS, LATCHED, declare_tree, json_msg, parse_json, quat_to_yaw  # 同じワークスペースの小物

DEFAULTS = {
    "agv_id": "AGV-01",
    "map_id": "demo_map",                     # 起動ファイルが map:= のファイル名で上書きする
    "map_locked": False,                      # 起動時に map:= を指定した（開発用）→ Web からの地図の切り替え（SET_MAP）を受けない
    "maps_dir": "",                           # 切り替え先の地図 <maps_dir>/<mapId>.yaml。空なら agv_navigation の maps
    "waypoints_file": "",                     # 空なら config/waypoints/<map_id>.yaml、無ければ config/waypoints.yaml
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
    "manual": {                               # Web のキーボード操縦（MANUAL_DRIVE）
        "max_linear": 0.3,                    # 前後の速さの上限 [m/s]
        "max_angular": 1.0,                   # 回転の上限 [rad/s]
        "timeout_s": 0.5,                     # Web から届かなければ止める [s]
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
        self.map_id = str(self.cfg["map_id"])
        wp_path = str(self.cfg["waypoints_file"]) or self._waypoints_file(self.map_id)
        self.waypoints = WaypointBook(wp_path)
        self.get_logger().info(f"地図 {self.map_id} ・ 地点 {len(self.waypoints.items)} 件: {wp_path}")
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
        self.pub_cmd_vel = self.create_publisher(Twist, "cmd_vel", 10)
        self.pub_map_status = self.create_publisher(String, "agv/map_status", EVENTS)
        self.pub_sim_map = self.create_publisher(String, "sim/set_map", LATCHED)
        self.load_map_cli = self.create_client(LoadMap, "map_server/load_map")
        self.clear_costmap_cli = [self.create_client(ClearEntireCostmap, n) for n in (
            "global_costmap/clear_entirely_global_costmap", "local_costmap/clear_entirely_local_costmap")]

        self.logic = MissionLogic(self.cfg, self.waypoints, self.nav,
                                  publish_task=lambda d: self.pub_task.publish(json_msg(d)),
                                  publish_event=self._event,
                                  log=lambda t: self.get_logger().info(t),
                                  publish_cmd=self._publish_cmd_vel)

        self.create_subscription(String, "agv/command", self._on_command, EVENTS)
        self.create_subscription(String, "agv/map_config", lambda m: self.request_map(str(parse_json(m).get("mapId") or "")), LATCHED)
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
        # 地図の切り替え（SET_MAP）
        self.map_locked = bool(self.cfg["map_locked"])
        self._map_want: str | None = None     # 切り替え待ちの地図
        self._map_want_since = 0.0
        self._map_loading = False             # Nav2 の返事待ち
        self._map_pending_said = False
        self._map_locked_said: str | None = None
        self._repose: list[float] = []        # 切り替え後に現在地を送り直す時刻

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

    def _waypoints_file(self, map_id: str) -> str:
        """地図ごとの地点ファイル。その地図用が無ければ、共通の config/waypoints.yaml"""
        per_map = self._share_file("config", "waypoints", f"{map_id}.yaml")
        return per_map if os.path.isfile(per_map) else self._share_file("config", "waypoints.yaml")

    def _share_file(self, *parts) -> str:
        try:
            from ament_index_python.packages import get_package_share_directory
            return os.path.join(get_package_share_directory("agv_navigation"), *parts)
        except Exception:
            return str(Path(__file__).resolve().parent.parent.joinpath(*parts))

    def _publish_cmd_vel(self, v: float, w: float) -> None:
        m = Twist()
        m.linear.x = float(v)
        m.angular.z = float(w)
        self.pub_cmd_vel.publish(m)

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
        if d.get("action") != "MANUAL_DRIVE":   # 手動操縦は 0.2 秒ごとに届くのでログに出さない
            self.get_logger().info(f"コマンド: {json.dumps(d, ensure_ascii=False)}")
        if d.get("action") == "SET_MAP":
            self.request_map(str(d.get("mapId") or ""))
            return
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
            # 別の地図で保存した位置は使わない（座標の意味が違うため）。地図名の無い古い保存は demo_map とみなす
            if str(data.get("mapId", "demo_map")) != self.map_id:
                self.get_logger().info(f"前回の位置は地図 {data.get('mapId', 'demo_map')} のものなので使いません")
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
            tmp.write_text(json.dumps({**pose.to_dict(), "mapId": self.map_id, "time": now}), encoding="utf-8")
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
    #  地図の切り替え（SET_MAP。docs/agv_protocol.md 2-8, 2-9）
    # ------------------------------------------------------------------
    def _map_status(self, state: str, map_id: str, reason: str) -> None:
        d = {"state": state, "mapId": map_id, "from": self.map_id, "reason": reason}
        # rclpy は「同じ行から違う重さのログ」を出すと例外になるので、行を分ける
        if state in ("FAILED", "LOCKED"):
            self.get_logger().warn(f"地図: {state} {reason}")
        else:
            self.get_logger().info(f"地図: {state} {reason}")
        self.pub_map_status.publish(json_msg(d))

    def _map_file(self, map_id: str) -> str:
        d = str(self.cfg["maps_dir"])
        return os.path.join(os.path.expanduser(d), f"{map_id}.yaml") if d else self._share_file("maps", f"{map_id}.yaml")

    def request_map(self, map_id: str) -> None:
        """Web から「この地図を使う」が届いた。止まっていればすぐ、動いていれば止まってから切り替える"""
        map_id = map_id.strip()
        if not map_id:
            return
        if map_id == self.map_id:
            if self._map_want:     # 待っている間に元の地図に戻された
                self.get_logger().info(f"地図の切り替え（{self._map_want}）をやめました（{map_id} のまま）")
                self._map_want = None
            return
        if self.map_locked:
            if self._map_locked_said != map_id:   # retain なので再接続のたびに届く。同じ地図では1回だけ知らせる
                self._map_locked_said = map_id
                self._map_status("LOCKED", map_id, f"起動時に map:= で {self.map_id} を指定しているので、{map_id} に切り替えません")
            return
        if not map_id.replace("_", "").replace("-", "").isalnum():
            self._map_status("FAILED", map_id, f"地図の名前が正しくありません: {map_id}")
            return
        if not os.path.isfile(self._map_file(map_id)):
            self._map_status("FAILED", map_id, f"地図ファイルがありません: {self._map_file(map_id)}")
            return
        self._map_want = map_id
        self._map_want_since = time.time()
        self._map_pending_said = False

    def _busy_reason(self) -> str:
        lg = self.logic
        if lg.tasks.current is not None or lg.tasks.queue:
            return "タスク・移動の途中"
        if lg.manual:
            return "手動操縦中"
        if abs(self.speed) > 0.02:
            return "走行中"
        return ""

    def _try_map_change(self, now: float) -> None:
        if not self._map_want or self._map_loading:
            return
        map_id = self._map_want
        busy = self._busy_reason()
        if busy:
            if not self._map_pending_said:
                self._map_pending_said = True
                self._map_status("PENDING", map_id, f"{busy}なので、止まってから {map_id} に切り替えます")
            return
        if not self.load_map_cli.service_is_ready():
            if now - self._map_want_since > 60.0:   # Nav2 が起動しない
                self._map_want = None
                self._map_status("FAILED", map_id, "Nav2 の地図サーバー（map_server/load_map）が使えません")
            return
        if not self.amcl_seen and now - self._map_want_since < 30.0:
            return   # 起動直後: Nav2（AMCL）が動き出すまで待つ（起動しきる前の地図サーバーは読み直しに失敗することがある）
        path = self._map_file(map_id)
        self._map_loading = True
        self.get_logger().info(f"地図を読み直します: {path}")
        fut = self.load_map_cli.call_async(LoadMap.Request(map_url=path))
        fut.add_done_callback(lambda f: self._on_map_loaded(map_id, path, f))

    def _on_map_loaded(self, map_id: str, path: str, fut) -> None:
        self._map_loading = False
        if self._map_want == map_id:
            self._map_want = None
        try:
            res = fut.result()
        except Exception as e:
            res = None
            self.get_logger().error(f"LoadMap: {e}")
        if res is None or res.result != LoadMap.Response.RESULT_SUCCESS:
            code = "?" if res is None else res.result
            self._map_status("FAILED", map_id, f"Nav2 が地図を読めませんでした（{path}、結果 {code}）。元の地図のままです")
            return
        old = self.map_id
        self.map_id = map_id
        wp_path = self._waypoints_file(map_id)
        self.waypoints = WaypointBook(wp_path)
        self.logic.waypoints = self.waypoints
        self.get_logger().info(f"地図 {old} → {map_id} ・ 地点 {len(self.waypoints.items)} 件: {wp_path}")
        # 新しい地図での現在地: 少し前にこの地図で保存した位置があればそこ、無ければ Home
        pose = self._load_saved_pose() or parse_pose(self.cfg["localization"]["initial_pose"], self.waypoints)
        for c in self.clear_costmap_cli:          # 前の地図の障害物を消す
            if c.service_is_ready():
                c.call_async(ClearEntireCostmap.Request())
        if pose is None:
            reason = f"地図を {map_id} に切り替えました。地点 '{self.cfg['localization']['initial_pose']}' が無いので、現在地を設定（SET_POSE）してください"
        else:
            self.pub_sim_map.publish(json_msg({"mapId": map_id, "path": path,
                                               "start": [pose.x, pose.y, math.degrees(pose.theta)]}))
            self._initial_pose = pose
            self.amcl_seen = False                # 新しい地図での AMCL の推定が届くまで、位置を保存しない
            self._initial_tries = 0
            now = time.time()
            self._repose = [now + 1.0, now + 3.0]  # シミュレーターが車を置き直すのを待ってから送る
            reason = f"地図を {old} から {map_id} に切り替えました。現在地 ({pose.x:.2f}, {pose.y:.2f})"
        d = {"state": "CHANGED", "mapId": map_id, "from": old, "reason": reason}
        self.get_logger().info(f"地図: CHANGED {reason}")
        self.pub_map_status.publish(json_msg(d))

    def _repose_tick(self, now: float) -> None:
        if self._repose and now >= self._repose[0]:
            self._repose.pop(0)
            if self._initial_pose is not None:
                self.publish_initial_pose(self._initial_pose)

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
        self._try_map_change(now)
        self._repose_tick(now)
        self._save_pose(now, pose)
        if now - self._t_state >= 1.0 / float(self.cfg["publish"]["state_hz"]):
            self._t_state = now
            payload = lg.summary()
            payload.update({"mapId": self.map_id, "speed": round(self.speed, 2),
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
