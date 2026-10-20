"""カメラの映像を ROS に流すノード（ラズパイ）。

出すもの:
  camera/image_raw/compressed   sensor_msgs/CompressedImage (JPEG)   ← Wi-Fi で送るので圧縮のまま
  camera/camera_info            sensor_msgs/CameraInfo               ← camera_calib.yaml の内容

映像の取り出し方（camera.source）:
  mjpeg     … http://... の MJPEG を読む（Docker の中から Pi Camera を使うとき。ホスト側で
              edge_ai/docker/pi_camera_relay.py を動かす。JPEG をそのまま流すので CPU をほぼ使わない）
  picamera2 … Picamera2 で直接読む（Docker を使わず Raspberry Pi OS に ROS を入れた場合）
  opencv    … USB カメラ（/dev/video番号）
  auto      … picamera2 → mjpeg → opencv の順に試す
"""
from __future__ import annotations

import threading
import time
import urllib.request
from pathlib import Path

import rclpy
import yaml
from rclpy.node import Node
from sensor_msgs.msg import CameraInfo, CompressedImage

from .ros_utils import SENSOR, declare_tree

DEFAULTS = {
    "camera": {
        "source": "auto",
        "url": "http://127.0.0.1:8090/stream.mjpg",
        "device": 0,
        "width": 640,
        "height": 480,
        "fps": 10.0,
        "jpeg_quality": 70,
        "calib_file": "",
    },
    "frames": {"camera_optical": "camera_optical_frame"},
}


def iter_mjpeg(url: str, timeout: float = 5.0):
    """MJPEG ストリームから JPEG を1枚ずつ取り出す（デコードしない）。"""
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        buf = b""
        while True:
            chunk = resp.read(16384)
            if not chunk:
                return
            buf += chunk
            while True:
                s = buf.find(b"\xff\xd8")
                if s < 0:
                    buf = buf[-1:]
                    break
                e = buf.find(b"\xff\xd9", s + 2)
                if e < 0:
                    if s > 0:
                        buf = buf[s:]
                    break
                yield buf[s:e + 2]
                buf = buf[e + 2:]
            if len(buf) > 4_000_000:
                buf = b""


def load_camera_info(path: str, width: int, height: int, frame_id: str) -> CameraInfo:
    ci = CameraInfo()
    ci.header.frame_id = frame_id
    ci.width, ci.height = width, height
    K = [[259.0, 0.0, 320.0], [0.0, 259.0, 240.0], [0.0, 0.0, 1.0]]
    D = [0.0, 0.0, 0.0, 0.0, 0.0]
    cw, ch = 640, 480
    if path and Path(path).exists():
        c = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
        K = c.get("camera_matrix", K)
        D = list(c.get("dist_coeffs", D))
        cw, ch = int(c.get("width", cw)), int(c.get("height", ch))
    sx, sy = width / cw, height / ch
    fx, fy, cx, cy = K[0][0] * sx, K[1][1] * sy, K[0][2] * sx, K[1][2] * sy
    ci.distortion_model = "plumb_bob"
    ci.d = [float(v) for v in D]
    ci.k = [fx, 0.0, cx, 0.0, fy, cy, 0.0, 0.0, 1.0]
    ci.r = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
    ci.p = [fx, 0.0, cx, 0.0, 0.0, fy, cy, 0.0, 0.0, 0.0, 1.0, 0.0]
    return ci


class CameraNode(Node):
    def __init__(self):
        super().__init__("camera_node")
        self.cfg = declare_tree(self, DEFAULTS)
        c = self.cfg["camera"]
        self.frame_id = str(self.cfg["frames"]["camera_optical"])
        self.w, self.h = int(c["width"]), int(c["height"])
        self.info = load_camera_info(str(c["calib_file"]), self.w, self.h, self.frame_id)
        self.pub_img = self.create_publisher(CompressedImage, "camera/image_raw/compressed", SENSOR)
        self.pub_info = self.create_publisher(CameraInfo, "camera/camera_info", SENSOR)
        self._running = True
        self.frames = 0
        threading.Thread(target=self._loop, name="camera", daemon=True).start()

    def destroy_node(self):
        self._running = False
        return super().destroy_node()

    def _publish_jpeg(self, data: bytes) -> None:
        stamp = self.get_clock().now().to_msg()
        m = CompressedImage()
        m.header.stamp = stamp
        m.header.frame_id = self.frame_id
        m.format = "jpeg"
        m.data = data
        self.pub_img.publish(m)
        self.info.header.stamp = stamp
        self.pub_info.publish(self.info)
        self.frames += 1

    # ---- 取り出し方ごとのループ ----
    def _loop(self) -> None:
        src = str(self.cfg["camera"]["source"]).lower()
        order = {"auto": ["picamera2", "mjpeg", "opencv"]}.get(src, [src])
        while self._running:
            for s in order:
                try:
                    getattr(self, f"_run_{s}")()
                except Exception as e:
                    self.get_logger().warn(f"カメラ ({s}) が使えません: {e}", throttle_duration_sec=30.0)
                if not self._running:
                    return
            time.sleep(2.0)

    def _run_mjpeg(self) -> None:
        url = str(self.cfg["camera"]["url"])
        period = 1.0 / float(self.cfg["camera"]["fps"])
        last = 0.0
        self.get_logger().info(f"カメラ: MJPEG {url}")
        for jpg in iter_mjpeg(url):
            if not self._running:
                return
            now = time.time()
            if now - last >= period * 0.9:   # 送る枚数を fps に合わせる
                last = now
                self._publish_jpeg(jpg)

    def _run_picamera2(self) -> None:
        import cv2
        from picamera2 import Picamera2  # type: ignore
        c = self.cfg["camera"]
        cam = Picamera2()
        cam.configure(cam.create_video_configuration(main={"size": (self.w, self.h), "format": "RGB888"},
                                                     controls={"FrameRate": float(c["fps"])}))
        cam.start()
        try:
            from libcamera import controls  # type: ignore
            cam.set_controls({"AfMode": controls.AfModeEnum.Continuous})  # Camera Module 3 のオートフォーカス
        except Exception:
            pass
        self.get_logger().info("カメラ: Picamera2")
        q = [int(cv2.IMWRITE_JPEG_QUALITY), int(c["jpeg_quality"])]
        try:
            while self._running:
                frame = cam.capture_array("main")   # RGB888 はメモリ上 BGR の順
                ok, buf = cv2.imencode(".jpg", frame, q)
                if ok:
                    self._publish_jpeg(buf.tobytes())
        finally:
            cam.stop()
            cam.close()

    def _run_opencv(self) -> None:
        import cv2
        c = self.cfg["camera"]
        cap = cv2.VideoCapture(int(c["device"]), cv2.CAP_V4L2)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.w)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.h)
        cap.set(cv2.CAP_PROP_FPS, float(c["fps"]))
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if not cap.isOpened():
            raise RuntimeError(f"/dev/video{c['device']} を開けません")
        self.get_logger().info(f"カメラ: OpenCV /dev/video{c['device']}")
        q = [int(cv2.IMWRITE_JPEG_QUALITY), int(c["jpeg_quality"])]
        try:
            while self._running:
                ok, frame = cap.read()
                if not ok:
                    raise RuntimeError("フレームを読めません")
                ok, buf = cv2.imencode(".jpg", frame, q)
                if ok:
                    self._publish_jpeg(buf.tobytes())
        finally:
            cap.release()


def main(args=None):
    rclpy.init(args=args)
    node = CameraNode()
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
