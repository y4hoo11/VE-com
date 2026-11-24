"""WASD で車を動かす（ラズパイの agv_robot コンテナで実行。車体を浮かせて試す）。

    docker exec -it agv_robot bash
    ros2 run agv_main wasd_teleop                    （速さ 0.15 m/s）
    ros2 run agv_main wasd_teleop --speed 0.2

    W / S   押している間 前進 / 後退
    A / D   押している間 ハンドルを左 / 右（W・S と一緒に使える。止まっているときはハンドルだけ動く）
    スペース すぐ止まる        + / -  速さを上げる / 下げる        Q  終わる

キーを離すと 0.6 秒以内に止まる（ターミナルはキーを押しっぱなしにしたとき、
最初の繰り返しまで 0.5 秒くらい空くので、それより少し長く待つ）。
ターミナルは「最後に押したキー」しか繰り返さないため、W を押したまま A を押すと W の繰り返しが止まる。
そこで、走っている間に A・D を押すと前進・後退も続く作りにしている。

/cmd_vel（geometry_msgs/Twist）に出す。serial_bridge が受け取り、安全ガードを通して ESP32 へ送る。
Nav2（run_pc1.sh）や Web の手動操縦と同時に使わないこと（指示がぶつかる）。
"""
from __future__ import annotations

import argparse
import math
import select
import sys
import termios
import time
import tty

HOLD_S = 0.6           # キーを離してから止まるまで [s]
RATE_HZ = 20.0         # /cmd_vel を出す回数
SPEED_STEP = 0.05      # + / - で変わる速さ [m/s]
SPEED_MIN, SPEED_MAX = 0.05, 1.0
STEER_ONLY_W = 0.5     # 止まっているときハンドルだけ切るための回転指令 [rad/s]（serial_bridge が「ハンドルだけ」に変換）


class WasdState:
    """押されたキーと時刻から (v [m/s], ω [rad/s]) を決める。ROS なしでテストできる。"""

    def __init__(self, speed: float = 0.15, wheelbase: float = 0.257, max_steer_deg: float = 25.0):
        self.speed = speed
        self.L = wheelbase
        self.max_steer = math.radians(max_steer_deg)
        self.drive_dir = 0       # +1 前進 / -1 後退 / 0 止まる
        self.drive_until = 0.0
        self.steer_dir = 0       # +1 左 / -1 右 / 0 まっすぐ
        self.steer_until = 0.0
        self.quit = False

    def key(self, ch: str, now: float) -> None:
        c = ch.lower()
        if c == "w":
            self.drive_dir, self.drive_until = 1, now + HOLD_S
        elif c == "s":
            self.drive_dir, self.drive_until = -1, now + HOLD_S
        elif c in ("a", "d"):
            self.steer_dir, self.steer_until = (1 if c == "a" else -1), now + HOLD_S
            if self.drive_dir != 0 and now < self.drive_until:
                self.drive_until = now + HOLD_S   # 走っている間にハンドルを切ったら、走るのも続ける
        elif c == " ":
            self.stop()
        elif c in ("+", "="):
            self.speed = min(SPEED_MAX, round(self.speed + SPEED_STEP, 2))
        elif c in ("-", "_"):
            self.speed = max(SPEED_MIN, round(self.speed - SPEED_STEP, 2))
        elif c in ("q", "\x03"):   # \x03 = Ctrl+C
            self.stop()
            self.quit = True

    def stop(self) -> None:
        self.drive_dir = self.steer_dir = 0
        self.drive_until = self.steer_until = 0.0

    def twist(self, now: float) -> tuple[float, float]:
        drive = self.drive_dir if now < self.drive_until else 0
        steer = self.steer_dir if now < self.steer_until else 0
        if drive == 0:
            return 0.0, (STEER_ONLY_W * steer)
        v = drive * self.speed
        # ハンドルいっぱい（max_steer）になる回転。後退でも A = タイヤが左を向くように v の符号ごと掛ける
        w = v * math.tan(self.max_steer) / self.L * steer
        return v, w


def _status(st: WasdState, v: float, w: float) -> str:
    move = "前進" if v > 0 else "後退" if v < 0 else "停止"
    steer = "左" if (w > 0) == (v >= 0) and w != 0 else "右" if w != 0 else "まっすぐ"
    return f"\r速さ {st.speed:.2f} m/s | {move:2s} | ハンドル {steer:4s}   "


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="WASD で /cmd_vel を出す")
    ap.add_argument("--speed", type=float, default=0.15, help="最初の速さ [m/s]（初期値 0.15）")
    ap.add_argument("--topic", default="cmd_vel")
    args, ros_args = ap.parse_known_args(argv)

    import rclpy
    from geometry_msgs.msg import Twist

    rclpy.init(args=ros_args)
    node = rclpy.create_node("wasd_teleop")
    pub = node.create_publisher(Twist, args.topic, 10)
    st = WasdState(speed=max(SPEED_MIN, min(SPEED_MAX, args.speed)))

    print(__doc__.split("\n\n")[1])
    print("（半角英字で。日本語入力になっていたら「半角/全角」キーで切り替える）\n")

    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    zeros_left = 0
    try:
        tty.setcbreak(fd)
        period = 1.0 / RATE_HZ
        next_t = time.time()
        while not st.quit and rclpy.ok():
            r, _, _ = select.select([sys.stdin], [], [], max(0.0, next_t - time.time()))
            if r:
                for ch in sys.stdin.read(1):
                    st.key(ch, time.time())
                continue
            next_t += period
            now = time.time()
            v, w = st.twist(now)
            moving = v != 0.0 or w != 0.0
            if moving:
                zeros_left = 5          # 止まったあと 0 を 5 回だけ出して、あとは黙る（他の指示の邪魔をしない）
            if moving or zeros_left > 0:
                m = Twist()
                m.linear.x, m.angular.z = v, w
                pub.publish(m)
                if not moving:
                    zeros_left -= 1
            sys.stdout.write(_status(st, v, w))
            sys.stdout.flush()
    finally:
        for _ in range(3):
            pub.publish(Twist())       # 終わるときは必ず止める
            time.sleep(0.02)
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
        print("\n終わりました（停止を送りました）")
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
