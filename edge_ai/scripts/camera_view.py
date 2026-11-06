#!/usr/bin/env python3
"""
ラズパイのカメラ映像を、同じネットワークの PC のブラウザで見るためのスクリプト（単体で動く。ROS も Docker も不要）

  USB カメラでも Pi カメラ（CSI）でも使える。映りの確認・ピント合わせ・取り付け角度の調整用。

使い方（ラズパイで）:
    python3 edge_ai/scripts/camera_view.py                 # 自動（Pi カメラがあればそれ、無ければ USB）
    python3 edge_ai/scripts/camera_view.py --source usb    # USB カメラ（/dev/video0）
    python3 edge_ai/scripts/camera_view.py --source usb --device 1
    python3 edge_ai/scripts/camera_view.py --source picam  # Pi カメラ
    python3 edge_ai/scripts/camera_view.py --list          # つながっているカメラを一覧
    python3 edge_ai/scripts/camera_view.py --source test   # カメラ無しで動作確認（テスト画像）

  起動すると「PC のブラウザでここを開く: http://192.168.x.x:8091/」と出るので、PC でそれを開く。
  止めるときは Ctrl+C。

必要なもの（ラズパイ）:
    sudo apt install -y python3-opencv          # USB カメラ・画像の圧縮に使う
    sudo apt install -y python3-picamera2       # Pi カメラを使うときだけ（Raspberry Pi OS なら最初から入っていることが多い）

注意:
  - 1 つのカメラは同時に 1 つのプログラムしか使えない。車両のコンテナ（start_robot.sh）や
    pi-camera-relay が同じカメラを使っているときは、先に止める:
        bash edge_ai/scripts/start_robot.sh stop
        sudo systemctl stop pi-camera-relay
  - ポートは 8091（pi-camera-relay の 8090 とぶつからないように）。--port で変えられる。
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import cv2
    import numpy as np
except ImportError:
    print("OpenCV が見つかりません。ラズパイで次を実行してください:\n  sudo apt install -y python3-opencv")
    sys.exit(1)


# ---------------------------------------------------------------------------
# カメラ（3 種類）。どれも read() で BGR の画像（numpy 配列）を返す
# ---------------------------------------------------------------------------
class UsbCamera:
    """USB カメラ（UVC）。OpenCV の V4L2 で読む"""

    def __init__(self, device: str, width: int, height: int, fps: int):
        dev = int(device) if str(device).isdigit() else device
        self.cap = cv2.VideoCapture(dev, cv2.CAP_V4L2)
        if not self.cap.isOpened():
            raise RuntimeError(f"USB カメラ {device} を開けません（--list で番号を確認）")
        # MJPG にすると USB の帯域に余裕ができ、解像度・fps を上げやすい（対応していなければ無視される）
        self.cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        self.cap.set(cv2.CAP_PROP_FPS, fps)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)   # 古いコマを溜めない（遅れを減らす）
        w = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self.name = f"USB カメラ {device}（{w}x{h}）"

    def read(self):
        ok, frame = self.cap.read()
        return frame if ok else None

    def close(self):
        self.cap.release()


class PiCamera:
    """Pi カメラ（CSI）。Picamera2 で読む"""

    def __init__(self, index: int, width: int, height: int, fps: int):
        try:
            from picamera2 import Picamera2
        except ImportError:
            raise RuntimeError("picamera2 がありません: sudo apt install -y python3-picamera2")
        if not Picamera2.global_camera_info():
            raise RuntimeError("Pi カメラが見つかりません（リボンケーブルの向き・差し込みを確認）")
        self.cam = Picamera2(index)
        # "RGB888" は並びが B,G,R なので、そのまま OpenCV で使える
        cfg = self.cam.create_video_configuration(
            main={"size": (width, height), "format": "RGB888"},
            controls={"FrameRate": fps})
        self.cam.configure(cfg)
        self.cam.start()
        model = Picamera2.global_camera_info()[index].get("Model", "?")
        self.name = f"Pi カメラ {model}（{width}x{height}）"

    def read(self):
        return self.cam.capture_array("main")

    def close(self):
        self.cam.stop()
        self.cam.close()


class TestCamera:
    """カメラ無しで動作確認するためのテスト画像"""

    def __init__(self, width: int, height: int, fps: int):
        self.w, self.h, self.dt = width, height, 1.0 / max(fps, 1)
        self.name = f"テスト画像（{width}x{height}）"
        self.t0 = time.time()

    def read(self):
        time.sleep(self.dt)
        img = np.zeros((self.h, self.w, 3), np.uint8)
        bars = [(255, 255, 255), (0, 255, 255), (255, 255, 0), (0, 255, 0), (255, 0, 255), (0, 0, 255), (255, 0, 0)]
        bw = self.w // len(bars)
        for i, c in enumerate(bars):
            img[:, i * bw:(i + 1) * bw] = c
        x = int((time.time() - self.t0) * 200) % self.w
        cv2.circle(img, (x, self.h // 2), 30, (30, 30, 30), -1)   # 動く丸（止まっていないか見る用）
        return img

    def close(self):
        pass


def open_camera(args):
    if args.source == "test":
        return TestCamera(args.width, args.height, args.fps)
    if args.source == "usb":
        return UsbCamera(args.device, args.width, args.height, args.fps)
    if args.source == "picam":
        return PiCamera(args.picam_index, args.width, args.height, args.fps)
    # auto: Pi カメラ → USB の順に試す
    try:
        return PiCamera(args.picam_index, args.width, args.height, args.fps)
    except Exception as e:
        print(f"[auto] Pi カメラは使えません: {e}")
    return UsbCamera(args.device, args.width, args.height, args.fps)


def list_cameras():
    print("== USB / V4L2 のデバイス ==")
    devs = sorted(glob.glob("/dev/video*"), key=lambda p: int(p.replace("/dev/video", "") or 0))
    if not devs:
        print("  なし")
    for d in devs:
        n = d.replace("/dev/", "")
        try:
            name = open(f"/sys/class/video4linux/{n}/name").read().strip()
        except OSError:
            name = "?"
        cap = cv2.VideoCapture(d, cv2.CAP_V4L2)
        ok = cap.isOpened() and cap.read()[0]
        cap.release()
        mark = "映像あり ← --device " + n.replace("video", "") if ok else "映像なし（Pi カメラの内部用・メタデータ用など）"
        print(f"  {d:14s} {name:30s} {mark}")
    print("== Pi カメラ（CSI） ==")
    try:
        from picamera2 import Picamera2
        info = Picamera2.global_camera_info()
        if not info:
            print("  なし")
        for i, c in enumerate(info):
            print(f"  {i}: {c.get('Model', '?')}  ← --source picam --picam-index {i}")
    except ImportError:
        print("  picamera2 が入っていないので調べられません")


# ---------------------------------------------------------------------------
# 最新の 1 コマを JPEG にして持っておく（何人ブラウザで見ても、カメラは 1 回だけ読む）
# ---------------------------------------------------------------------------
class FrameHub:
    def __init__(self, cam, args):
        self.cam, self.args = cam, args
        self.jpeg: bytes | None = None
        self.seq = 0
        self.fps = 0.0
        self.size = (0, 0)
        self.errors = 0
        self.cond = threading.Condition()
        self.running = True
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def _loop(self):
        rot = {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}.get(self.args.rotate)
        last = time.time()
        while self.running:
            frame = self.cam.read()
            if frame is None:
                self.errors += 1
                if self.errors % 30 == 1:
                    print("カメラから画像が来ません（ケーブル・電源・他のプログラムが使っていないか確認）")
                time.sleep(0.1)
                continue
            if rot is not None:
                frame = cv2.rotate(frame, rot)
            if self.args.flip:
                frame = cv2.flip(frame, 1)
            now = time.time()
            self.fps = 0.9 * self.fps + 0.1 * (1.0 / max(now - last, 1e-3))
            last = now
            self.size = (frame.shape[1], frame.shape[0])
            if not self.args.no_overlay:
                text = f"{time.strftime('%H:%M:%S')}.{int(now * 10) % 10}  {self.fps:4.1f} fps  {self.size[0]}x{self.size[1]}"
                cv2.putText(frame, text, (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 4, cv2.LINE_AA)
                cv2.putText(frame, text, (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 1, cv2.LINE_AA)
            ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, self.args.quality])
            if not ok:
                continue
            with self.cond:
                self.jpeg = buf.tobytes()
                self.seq += 1
                self.cond.notify_all()

    def wait_next(self, seq: int, timeout: float = 2.0):
        with self.cond:
            self.cond.wait_for(lambda: self.seq != seq or not self.running, timeout)
            return self.seq, self.jpeg

    def stop(self):
        self.running = False
        with self.cond:
            self.cond.notify_all()


PAGE = """<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>ラズパイのカメラ</title>
<style>body{margin:0;background:#15191e;color:#e6e9ec;font-family:sans-serif}
header{padding:10px 16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
img{display:block;max-width:100%;max-height:calc(100vh - 60px);margin:0 auto;background:#000}
a{color:#f0a060}</style></head><body>
<header><b>__NAME__</b><span id="info">接続中…</span>
<a href="/snapshot.jpg" download="snapshot.jpg">静止画を保存</a></header>
<img src="/stream.mjpg" alt="カメラ映像">
<script>
setInterval(async()=>{try{const r=await fetch('/info');const d=await r.json();
document.getElementById('info').textContent=`${d.width}x${d.height}  ${d.fps.toFixed(1)} fps  見ている人 ${d.clients}`;}
catch(e){document.getElementById('info').textContent='ラズパイとつながっていません';}},1000);
</script></body></html>"""


def make_handler(hub: FrameHub, cam_name: str):
    clients = {"n": 0}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):   # アクセスのたびにログを出さない
            pass

        def do_GET(self):
            path = self.path.split("?")[0]
            if path == "/":
                body = PAGE.replace("__NAME__", cam_name).encode()
                self._send(200, "text/html; charset=utf-8", body)
            elif path == "/snapshot.jpg":
                _, jpg = hub.wait_next(-1, 0.5)
                if jpg is None:
                    self._send(503, "text/plain; charset=utf-8", "まだ画像がありません".encode())
                else:
                    self._send(200, "image/jpeg", jpg)
            elif path == "/info":
                d = {"name": cam_name, "width": hub.size[0], "height": hub.size[1],
                     "fps": round(hub.fps, 1), "clients": clients["n"]}
                self._send(200, "application/json", json.dumps(d, ensure_ascii=False).encode())
            elif path == "/stream.mjpg":
                self._stream()
            else:
                self._send(404, "text/plain", b"not found")

        def _send(self, code, ctype, body):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _stream(self):
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            clients["n"] += 1
            seq = -1
            try:
                while hub.running:
                    seq, jpg = hub.wait_next(seq)
                    if jpg is None:
                        continue
                    self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\n")
                    self.wfile.write(f"Content-Length: {len(jpg)}\r\n\r\n".encode())
                    self.wfile.write(jpg)
                    self.wfile.write(b"\r\n")
            except (BrokenPipeError, ConnectionResetError):
                pass   # ブラウザを閉じた
            finally:
                clients["n"] -= 1

    return Handler


def my_ips() -> list[str]:
    try:
        out = subprocess.run(["hostname", "-I"], capture_output=True, text=True, timeout=2).stdout.split()
        ips = [ip for ip in out if ":" not in ip]   # IPv4 だけ
        if ips:
            return ips
    except Exception:
        pass
    try:
        return [socket.gethostbyname(socket.gethostname())]
    except Exception:
        return ["<ラズパイの IP>"]


def main():
    ap = argparse.ArgumentParser(description="ラズパイのカメラ映像を PC のブラウザで見る")
    ap.add_argument("--source", choices=["auto", "usb", "picam", "test"], default="auto",
                    help="auto: Pi カメラ → USB の順に探す（既定）")
    ap.add_argument("--device", default="0", help="USB カメラの番号か /dev/videoN（既定 0）")
    ap.add_argument("--picam-index", type=int, default=0, help="Pi カメラが 2 台あるときの番号")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--quality", type=int, default=80, help="JPEG の画質 1〜100（下げると軽くなる）")
    ap.add_argument("--rotate", type=int, choices=[0, 90, 180, 270], default=0, help="逆さまに付けたら 180")
    ap.add_argument("--flip", action="store_true", help="左右反転")
    ap.add_argument("--no-overlay", action="store_true", help="時刻・fps の文字を画像に入れない")
    ap.add_argument("--port", type=int, default=8091)
    ap.add_argument("--list", action="store_true", help="つながっているカメラを一覧して終わる")
    args = ap.parse_args()

    if args.list:
        list_cameras()
        return

    try:
        cam = open_camera(args)
    except Exception as e:
        print(f"カメラを開けませんでした: {e}")
        print("  つながっているカメラは: python3 edge_ai/scripts/camera_view.py --list")
        sys.exit(1)

    hub = FrameHub(cam, args)
    server = ThreadingHTTPServer(("0.0.0.0", args.port), make_handler(hub, cam.name))
    server.daemon_threads = True
    print(f"カメラ: {cam.name}")
    for ip in my_ips():
        print(f"PC のブラウザでここを開く: http://{ip}:{args.port}/")
    print("止めるときは Ctrl+C")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        hub.stop()
        server.server_close()
        cam.close()
        print("止めました")


if __name__ == "__main__":
    main()
