"""PC1 で動かす ROS ノード: カメラに ArUco マーカーが映ったら、AMCL の自己位置を補正する。

AMCL（LiDAR と地図の形合わせ）は、似た形の通路が続くと位置を見失うことがある。
壁に貼ったマーカー（位置は config/markers.yaml）が大きく映ったときに「車はここにいる」と計算し、
AMCL の推定と大きくずれていたり、AMCL の確からしさが低いときに initialpose で AMCL に教え直す。

購読:
  camera/image_raw/compressed  sensor_msgs/CompressedImage（ラズパイの camera_node）
  （image_transport: raw にすると camera/image_raw の sensor_msgs/Image。Gazebo の TurtleBot3 で試すとき用）
  camera/camera_info           sensor_msgs/CameraInfo（来なければ calib_file）
  amcl_pose                    AMCL の推定と確からしさ
  odom                         速く動いているときは補正しない（映像の遅れで誤差が出るため）
  TF map→base_link, base_link→camera_optical_frame
配信:
  initialpose                  geometry_msgs/PoseWithCovarianceStamped（補正するときだけ）
  agv/vision                   std_msgs/String(JSON)  見えたマーカーと補正の記録
  speed_limit                  nav2_msgs/SpeedLimit   人が近くに映ったら減速（YOLO を有効にしたときだけ）
HTTP（任意）:
  http://<PC1>:5000/video      マーカーの枠を描いた映像（MJPEG。Web の <img src> で表示できる）
"""
from __future__ import annotations

import math
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np
import rclpy
from geometry_msgs.msg import PoseWithCovarianceStamped
from nav_msgs.msg import Odometry
from rclpy.node import Node
from rclpy.time import Time
from sensor_msgs.msg import CameraInfo, CompressedImage, Image
from std_msgs.msg import String
from tf2_ros import Buffer, TransformListener

from agv_main.ros_utils import SENSOR, declare_tree, json_msg, quat_to_yaw

from .aruco_core import ArucoLocalizer, Pose2D, T_from_tf, load_markers, wrap_angle

DEFAULTS = {
    "agv_id": "AGV-01",
    "markers_file": "",                       # 空なら agv_vision/config/markers.yaml
    "calib_file": "",                         # camera_info が来ないときに使う（空なら agv_main/config/camera_calib.yaml）
    "frames": {"map": "map", "base": "base_link", "camera_optical": "camera_optical_frame"},
    "image_transport": "compressed",          # compressed / raw
    "process_hz": 5.0,
    "aruco_dict": "DICT_4X4_50",
    "marker_size": 0.15,                      # 印刷したマーカーの黒い四角の一辺 [m]
    "max_marker_distance": 2.5,
    "min_size_px": 60.0,                      # これより小さく映ったマーカーは向きが信用できないので補正に使わない
    "camera_mount": {"x": 0.18, "y": 0.0, "z": 0.15, "pitch_deg": 15.0, "yaw_deg": 0.0},  # TF が無いとき用
    "correction": {
        "enabled": True,
        "when_quality_below": 0.6,            # AMCL の確からしさがこれ未満なら補正
        "when_error_above": 0.35,             # AMCL とマーカーの位置がこれ以上ずれていたら補正 [m]
        "when_yaw_error_above_deg": 15.0,
        "big_jump": 1.0,                      # これ以上ずれるときは誤検出かもしれないので、続けて見えたら補正
        "big_jump_frames": 3,
        "cooldown_s": 3.0,                    # 補正の最短間隔
        "max_speed": 0.35,                    # これより速く走っているときは補正しない [m/s]
        "max_yaw_rate": 0.5,                  # [rad/s]
        "cov_xy": 0.08,                       # initialpose の不確かさ [m]
        "cov_deg": 6.0,
    },
    "http": {"enabled": True, "port": 5000},
    "yolo": {
        "enabled": False,                     # true にすると ultralytics の YOLO で人を探す（pip install ultralytics）
        "model": "yolov8n.pt",
        "conf": 0.45,
        "classes": ["person"],
        "min_height_frac": 0.25,              # 画面の高さのこの割合以上に映った人 = 近い
        "slow_percent": 50.0,                 # そのときの速度上限 [%]
        "hold_s": 1.5,
        "every_n_frames": 2,
    },
}


class _MjpegHandler(BaseHTTPRequestHandler):
    node: "MarkerLocalizer" = None  # type: ignore

    def log_message(self, *a):  # アクセスログは出さない
        pass

    def do_GET(self):  # noqa: N802
        if self.path.startswith("/snapshot"):
            jpg = self.node.latest_jpeg()
            if jpg is None:
                self.send_error(503)
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(jpg)))
            self.end_headers()
            self.wfile.write(jpg)
            return
        if not self.path.startswith("/video"):
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        last = None
        try:
            while True:
                jpg = self.node.latest_jpeg()
                if jpg is not None and jpg is not last:
                    last = jpg
                    self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                     + str(len(jpg)).encode() + b"\r\n\r\n" + jpg + b"\r\n")
                time.sleep(0.05)
        except (BrokenPipeError, ConnectionResetError):
            pass


class MarkerLocalizer(Node):
    def __init__(self):
        super().__init__("marker_localizer")
        self.cfg = declare_tree(self, DEFAULTS)
        fr = self.cfg["frames"]
        self.map_frame, self.base_frame = str(fr["map"]), str(fr["base"])
        markers_path = str(self.cfg["markers_file"]) or self._share("agv_vision", "config", "markers.yaml")
        calib = str(self.cfg["calib_file"]) or self._share("agv_main", "config", "camera_calib.yaml")
        self.markers = load_markers(markers_path)
        self.loc = ArucoLocalizer(self.cfg, self.cfg["camera_mount"], calib, self.markers)
        self.get_logger().info(f"マーカー {sorted(self.markers)} を {markers_path} から読み込みました")

        self.tf_buffer = Buffer()
        self.tf_listener = TransformListener(self.tf_buffer, self)
        self.mount_from_tf = False
        self.info_received = False
        self.quality = 0.0
        self.amcl_seen = False
        self.speed = 0.0
        self.yaw_rate = 0.0
        self._last_proc = 0.0
        self._last_corr = 0.0
        self._jump_buf: list[Pose2D] = []
        self._frame_n = 0
        self._jpeg_lock = threading.Lock()
        self._latest_jpeg: bytes | None = None
        self._busy = False

        if str(self.cfg["image_transport"]) == "raw":
            self.create_subscription(Image, "camera/image_raw", self._on_raw, SENSOR)
        else:
            self.create_subscription(CompressedImage, "camera/image_raw/compressed", self._on_compressed, SENSOR)
        self.create_subscription(CameraInfo, "camera/camera_info", self._on_info, SENSOR)
        self.create_subscription(PoseWithCovarianceStamped, "amcl_pose", self._on_amcl, 10)
        self.create_subscription(Odometry, "odom", self._on_odom, 10)
        self.pub_initial = self.create_publisher(PoseWithCovarianceStamped, "initialpose", 10)
        self.pub_vision = self.create_publisher(String, "agv/vision", 10)

        self.yolo = None
        self.pub_speed = None
        yc = self.cfg["yolo"]
        if bool(yc["enabled"]):
            self._init_yolo(yc)

        if bool(self.cfg["http"]["enabled"]):
            self._start_http(int(self.cfg["http"]["port"]))

    @staticmethod
    def _share(pkg: str, *parts) -> str:
        try:
            import os

            from ament_index_python.packages import get_package_share_directory
            return os.path.join(get_package_share_directory(pkg), *parts)
        except Exception:
            return ""

    # ------------------------------------------------------------------
    def _start_http(self, port: int) -> None:
        _MjpegHandler.node = self
        try:
            srv = ThreadingHTTPServer(("0.0.0.0", port), _MjpegHandler)
        except OSError as e:
            self.get_logger().warn(f"映像配信の HTTP サーバを起動できません (port {port}): {e}")
            return
        srv.daemon_threads = True
        threading.Thread(target=srv.serve_forever, name="mjpeg", daemon=True).start()
        self.get_logger().info(f"マーカー解析つきの映像: http://<PC1>:{port}/video")

    def latest_jpeg(self) -> bytes | None:
        with self._jpeg_lock:
            return self._latest_jpeg

    def _init_yolo(self, yc) -> None:
        try:
            from nav2_msgs.msg import SpeedLimit
            from ultralytics import YOLO  # type: ignore
            self.yolo = YOLO(str(yc["model"]))
            self.pub_speed = self.create_publisher(SpeedLimit, "speed_limit", 10)
            self._SpeedLimit = SpeedLimit
            self._slow_until = 0.0
            self._slow_active = False
            self.get_logger().info(f"YOLO を読み込みました: {yc['model']}")
        except Exception as e:
            self.get_logger().warn(f"YOLO を使えません（pip install ultralytics）: {e}")
            self.yolo = None

    # ------------------------------------------------------------------
    #  入力
    # ------------------------------------------------------------------
    def _on_info(self, msg: CameraInfo) -> None:
        if msg.k[0] > 0 and msg.width > 0:
            self.loc.set_intrinsics(np.array(msg.k).reshape(3, 3), list(msg.d) or [0, 0, 0, 0, 0], msg.width, msg.height)
            if not self.info_received:
                self.get_logger().info(f"camera_info を使います（{msg.width}x{msg.height}, fx={msg.k[0]:.1f}）")
            self.info_received = True

    def _on_amcl(self, msg: PoseWithCovarianceStamped) -> None:
        c = msg.pose.covariance
        sxy = math.sqrt(max(0.0, c[0]) + max(0.0, c[7]))
        syaw = math.sqrt(max(0.0, c[35]))
        self.quality = 1.0 / (1.0 + (sxy / 0.20) ** 2 + (syaw / 0.35) ** 2)
        self.amcl_seen = True

    def _on_odom(self, msg: Odometry) -> None:
        self.speed = float(msg.twist.twist.linear.x)
        self.yaw_rate = float(msg.twist.twist.angular.z)

    def _on_compressed(self, msg: CompressedImage) -> None:
        if not self._should_process():
            return
        frame = cv2.imdecode(np.frombuffer(bytes(msg.data), np.uint8), cv2.IMREAD_COLOR)
        if frame is not None:
            self._process(frame, msg.header)

    def _on_raw(self, msg: Image) -> None:
        if not self._should_process():
            return
        buf = np.frombuffer(bytes(msg.data), np.uint8)
        enc = msg.encoding.lower()
        try:
            if enc in ("bgr8", "rgb8"):
                frame = buf.reshape(msg.height, msg.step // 3 if msg.step else msg.width, 3)[:, :msg.width]
                if enc == "rgb8":
                    frame = frame[:, :, ::-1]
            elif enc in ("mono8", "8uc1"):
                frame = buf.reshape(msg.height, msg.step or msg.width)[:, :msg.width]
            else:
                self.get_logger().warn(f"対応していない画像形式: {msg.encoding}", throttle_duration_sec=30.0)
                return
        except ValueError:
            return
        self._process(np.ascontiguousarray(frame), msg.header)

    def _should_process(self) -> bool:
        now = time.time()
        if self._busy or now - self._last_proc < 1.0 / float(self.cfg["process_hz"]):
            return False
        self._last_proc = now
        return True

    # ------------------------------------------------------------------
    #  解析
    # ------------------------------------------------------------------
    def _update_mount(self, frame_id: str) -> None:
        if self.mount_from_tf:
            return
        try:
            t = self.tf_buffer.lookup_transform(self.base_frame, frame_id or str(self.cfg["frames"]["camera_optical"]), Time())
        except Exception:
            return
        tr, q = t.transform.translation, t.transform.rotation
        self.loc.set_mount(T_from_tf(tr.x, tr.y, tr.z, q.x, q.y, q.z, q.w))
        self.mount_from_tf = True
        self.get_logger().info(f"カメラの取り付け位置を TF から取得: ({tr.x:.2f}, {tr.y:.2f}, {tr.z:.2f})")

    def _pose_at(self, stamp) -> Pose2D | None:
        for when in (Time.from_msg(stamp), Time()):
            try:
                t = self.tf_buffer.lookup_transform(self.map_frame, self.base_frame, when)
            except Exception:
                continue
            tr = t.transform
            return Pose2D(tr.translation.x, tr.translation.y, quat_to_yaw(tr.rotation))
        return None

    def _process(self, frame: np.ndarray, header) -> None:
        self._busy = True
        try:
            self._update_mount(header.frame_id)
            obs = self.loc.detect(frame)
            self._frame_n += 1
            if self.yolo is not None and self._frame_n % max(1, int(self.cfg["yolo"]["every_n_frames"])) == 0:
                self._run_yolo(frame)
            corrected = self._maybe_correct(obs, header) if obs else None
            self._publish_debug(frame, obs, corrected)
        except Exception as e:
            self.get_logger().warn(f"画像の解析でエラー: {e!r}", throttle_duration_sec=10.0)
        finally:
            self._busy = False

    def _maybe_correct(self, obs, header) -> dict | None:
        cc = self.cfg["correction"]
        poses = [o.robot_pose for o in obs if o.pose_reliable]
        if not poses or not bool(cc["enabled"]):
            return None
        mx = sum(p.x for p in poses) / len(poses)
        my = sum(p.y for p in poses) / len(poses)
        mth = math.atan2(sum(math.sin(p.theta) for p in poses), sum(math.cos(p.theta) for p in poses))
        then = self._pose_at(header.stamp)
        now_pose = self._pose_at(Time().to_msg())
        if then is None or now_pose is None:
            # AMCL がまだ動いていない（地図上の位置が分からない）→ マーカーの位置をそのまま教える
            if self.amcl_seen:
                return None
            return self._send(Pose2D(mx, my, mth), "初期位置（AMCL 未初期化）", 0.0)
        # 撮影した時刻の推定位置との差を、今の推定位置に足す（映像の遅れの補正）
        dx, dy, dth = mx - then.x, my - then.y, wrap_angle(mth - then.theta)
        err = math.hypot(dx, dy)
        target = Pose2D(now_pose.x + dx, now_pose.y + dy, wrap_angle(now_pose.theta + dth))
        if abs(self.speed) > float(cc["max_speed"]) or abs(self.yaw_rate) > float(cc["max_yaw_rate"]):
            return None
        need = (self.quality < float(cc["when_quality_below"]) or err > float(cc["when_error_above"])
                or abs(math.degrees(dth)) > float(cc["when_yaw_error_above_deg"]))
        if not need or time.time() - self._last_corr < float(cc["cooldown_s"]):
            return None
        if err > float(cc["big_jump"]) and self.quality > 0.4:
            # 大きく違う → 誤検出かもしれない。同じ場所が続けて見えたら信じる
            self._jump_buf.append(target)
            n = int(cc["big_jump_frames"])
            if len(self._jump_buf) < n:
                return None
            a, b = self._jump_buf[-1], self._jump_buf[-n]
            self._jump_buf.clear()
            if math.hypot(a.x - b.x, a.y - b.y) > 0.3:
                return None
        else:
            self._jump_buf.clear()
        return self._send(target, f"ずれ {err:.2f}m / {math.degrees(dth):.0f}°, 確からしさ {self.quality:.2f}", err)

    def _send(self, pose: Pose2D, why: str, err: float) -> dict:
        cc = self.cfg["correction"]
        m = PoseWithCovarianceStamped()
        m.header.frame_id = self.map_frame
        m.header.stamp = self.get_clock().now().to_msg()
        m.pose.pose.position.x = float(pose.x)
        m.pose.pose.position.y = float(pose.y)
        m.pose.pose.orientation.z = math.sin(pose.theta / 2.0)
        m.pose.pose.orientation.w = math.cos(pose.theta / 2.0)
        cov = [0.0] * 36
        cov[0] = cov[7] = float(cc["cov_xy"]) ** 2
        cov[35] = math.radians(float(cc["cov_deg"])) ** 2
        m.pose.covariance = cov
        self.pub_initial.publish(m)
        self._last_corr = time.time()
        self.get_logger().info(f"マーカーで自己位置を補正: ({pose.x:.2f}, {pose.y:.2f}, {math.degrees(pose.theta):.0f}°) {why}")
        return {"x": round(pose.x, 3), "y": round(pose.y, 3), "theta": round(pose.theta, 3), "error": round(err, 3), "why": why}

    def _publish_debug(self, frame, obs, corrected) -> None:
        self.pub_vision.publish(json_msg({
            "markers": [{"id": o.id, "distance": None if o.distance is None else round(o.distance, 2),
                         "sizePx": round(o.size_px, 1), "reliable": o.pose_reliable} for o in obs],
            "corrected": corrected, "amclQuality": round(self.quality, 2),
        }))
        if not bool(self.cfg["http"]["enabled"]):
            return
        img = frame.copy()
        for o in obs:
            pts = o.corners.astype(int).reshape(-1, 1, 2)
            color = (0, 200, 0) if o.pose_reliable else (0, 200, 255)
            cv2.polylines(img, [pts], True, color, 2)
            label = f"id{o.id}" + (f" {o.distance:.2f}m" if o.distance else "")
            cv2.putText(img, label, tuple(pts[0][0]), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
        if corrected:
            cv2.putText(img, "CORRECTED", (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
        ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
        if ok:
            with self._jpeg_lock:
                self._latest_jpeg = buf.tobytes()

    def _run_yolo(self, frame) -> None:
        yc = self.cfg["yolo"]
        try:
            res = self.yolo.predict(frame, conf=float(yc["conf"]), verbose=False)[0]
        except Exception as e:
            self.get_logger().warn(f"YOLO 推論エラー: {e}", throttle_duration_sec=30.0)
            return
        watch = set(yc["classes"])
        h = frame.shape[0]
        close = False
        for b in res.boxes:
            label = res.names[int(b.cls[0])]
            x1, y1, x2, y2 = b.xyxy[0].tolist()
            if label in watch and (y2 - y1) > float(yc["min_height_frac"]) * h:
                close = True
        now = time.time()
        if close:
            self._slow_until = now + float(yc["hold_s"])
        want = now < self._slow_until
        if want != self._slow_active:
            self._slow_active = want
            m = self._SpeedLimit()
            m.header.stamp = self.get_clock().now().to_msg()
            m.percentage = True
            m.speed_limit = float(yc["slow_percent"]) if want else 100.0
            self.pub_speed.publish(m)
            self.get_logger().info("人が近くにいるので減速" if want else "減速を解除")


def main(args=None):
    rclpy.init(args=args)
    node = MarkerLocalizer()
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
