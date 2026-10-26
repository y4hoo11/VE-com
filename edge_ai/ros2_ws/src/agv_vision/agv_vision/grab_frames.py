"""カメラ映像（camera/image_raw/compressed）を Enter キーで保存する（キャリブレーション用）。

    ros2 run agv_vision grab_frames --ros-args -p out:=calib
    → Enter で1枚保存、q + Enter で終了。映像は http://<PC1>:5000/video で見ながら撮ると楽
"""
from __future__ import annotations

import threading
from pathlib import Path

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import CompressedImage

from agv_main.ros_utils import SENSOR


class GrabFrames(Node):
    def __init__(self):
        super().__init__("grab_frames")
        self.declare_parameter("out", "calib")
        self.out = Path(str(self.get_parameter("out").value))
        self.out.mkdir(parents=True, exist_ok=True)
        self.latest: bytes | None = None
        self.n = len(list(self.out.glob("calib_*.jpg")))
        self.create_subscription(CompressedImage, "camera/image_raw/compressed", self._on_img, SENSOR)
        threading.Thread(target=self._keys, daemon=True).start()
        print("Enter: 保存 / q + Enter: 終了")

    def _on_img(self, msg: CompressedImage) -> None:
        self.latest = bytes(msg.data)

    def _keys(self) -> None:
        while rclpy.ok():
            try:
                line = input()
            except EOFError:
                break
            if line.strip().lower() == "q":
                break
            if self.latest is None:
                print("まだ映像が届いていません")
                continue
            p = self.out / f"calib_{self.n:02d}.jpg"
            p.write_bytes(self.latest)
            self.n += 1
            print("保存:", p)
        rclpy.try_shutdown() if hasattr(rclpy, "try_shutdown") else rclpy.shutdown()


def main(args=None):
    rclpy.init(args=args)
    node = GrabFrames()
    try:
        rclpy.spin(node)
    except Exception:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
