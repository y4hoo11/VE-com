#!/usr/bin/env python3
"""ラズパイの「ホスト側」（Docker の外）で動かす、Pi Camera の MJPEG 配信。

Raspberry Pi Camera Module（CSI 接続）は Raspberry Pi OS の libcamera / Picamera2 でしか読めず、
Docker（Ubuntu ベースの ROS コンテナ）の中からは使いにくい。そこで:

    Pi Camera ──Picamera2──► この配信 http://127.0.0.1:8090/stream.mjpg ──► コンテナの camera_node（source: mjpeg）

    sudo apt install -y python3-picamera2
    python3 edge_ai/docker/pi_camera_relay.py                # 試しに動かす
    sudo cp edge_ai/docker/pi-camera-relay.service /etc/systemd/system/   # 自動起動（中のパスを直してから）
    sudo systemctl enable --now pi-camera-relay

ブラウザで http://<ラズパイのIP>:8090/stream.mjpg を開くと映像を確認できる。
JPEG はカメラ側でエンコードし、camera_node はそのまま ROS に流す（ラズパイの CPU をほとんど使わない）。
"""
import argparse
import io
import logging
import socketserver
from http import server
from threading import Condition

from picamera2 import Picamera2
from picamera2.encoders import JpegEncoder
from picamera2.outputs import FileOutput


class StreamingOutput(io.BufferedIOBase):
    def __init__(self):
        self.frame = None
        self.condition = Condition()

    def write(self, buf):
        with self.condition:
            self.frame = buf
            self.condition.notify_all()


OUTPUT = StreamingOutput()


class Handler(server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):  # noqa: N802
        if self.path not in ("/stream.mjpg", "/"):
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Age", "0")
        self.send_header("Cache-Control", "no-cache, private")
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=FRAME")
        self.end_headers()
        try:
            while True:
                with OUTPUT.condition:
                    OUTPUT.condition.wait()
                    frame = OUTPUT.frame
                self.wfile.write(b"--FRAME\r\n")
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Content-Length", str(len(frame)))
                self.end_headers()
                self.wfile.write(frame)
                self.wfile.write(b"\r\n")
        except Exception:
            pass


class StreamingServer(socketserver.ThreadingMixIn, server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--height", type=int, default=480)
    ap.add_argument("--fps", type=float, default=10.0)
    ap.add_argument("--quality", type=int, default=70)
    ap.add_argument("--port", type=int, default=8090)
    ap.add_argument("--hflip", action="store_true")
    ap.add_argument("--vflip", action="store_true")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [camera-relay] %(message)s")

    cam = Picamera2()
    cfg = cam.create_video_configuration(main={"size": (a.width, a.height)}, controls={"FrameRate": a.fps})
    if a.hflip or a.vflip:
        from libcamera import Transform
        cfg["transform"] = Transform(hflip=int(a.hflip), vflip=int(a.vflip))
    cam.configure(cfg)
    try:
        from libcamera import controls
        cam.set_controls({"AfMode": controls.AfModeEnum.Continuous})   # Camera Module 3 のオートフォーカス
    except Exception:
        pass
    cam.start_recording(JpegEncoder(q=a.quality), FileOutput(OUTPUT))
    logging.info("配信中: http://0.0.0.0:%d/stream.mjpg (%dx%d, %.0ffps)", a.port, a.width, a.height, a.fps)
    try:
        StreamingServer(("", a.port), Handler).serve_forever()
    finally:
        cam.stop_recording()


if __name__ == "__main__":
    main()
