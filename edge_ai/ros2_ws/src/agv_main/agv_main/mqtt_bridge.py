"""PC1 で動かす ROS ノード: Web（PC2 の backend / Mosquitto）⇔ ROS のトピック。

MQTT のトピックと JSON の形は前と同じ（docs/agv_protocol.md の 2-1〜2-5）なので、backend はそのまま使える。

    MQTT (PC2)                          ROS (PC1 / ラズパイ)
    agv/{id}/command ───────────────►  agv/command (String JSON) → mission_manager
       EMERGENCY_STOP / CLEAR ──────►  emergency_stop (Bool, ラッチ) → serial_bridge（ラズパイ）
    agv/broadcast/stop ─────────────►  emergency_stop = true
    agv/{id}/telemetry ◄────────────── agv/state (mission_manager, 2Hz) + agv/robot_info (ラズパイ, 1Hz)
    agv/{id}/task      ◄────────────── agv/task_status (mission_manager)
    agv/{id}/emergency ◄────────────── agv/events (ラズパイ) + agv/mission_events (mission_manager)
    agv/{id}/path      ◄────────────── plan (nav_msgs/Path, Nav2 の経路) を間引いたもの
    agv/{id}/online    ◄────────────── このノードの接続状態（retain + 遺言 LWT）

paho-mqtt は Dockerfile で python3-paho-mqtt を入れてある（1.x / 2.x どちらでも動く）。
"""
from __future__ import annotations

import json
import os
import threading
import time

import rclpy
from nav_msgs.msg import Path
from rclpy.node import Node
from std_msgs.msg import Bool, String

from .ros_utils import EVENTS, LATCHED, declare_tree, json_msg, parse_json

DEFAULTS = {
    "agv_id": "AGV-01",
    "mqtt": {"host": "mosquitto", "port": 1883, "keepalive": 30, "client_id": ""},
    "path_publish_s": 1.0,
    "path_stride": 4,
}


def make_client(client_id: str):
    import paho.mqtt.client as mqtt
    try:
        return mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)
    except AttributeError:  # paho-mqtt 1.x
        return mqtt.Client(client_id=client_id)


class MqttBridge(Node):
    def __init__(self):
        super().__init__("mqtt_bridge")
        self.cfg = declare_tree(self, DEFAULTS)
        self.id = str(os.environ.get("AGV_ID") or self.cfg["agv_id"])
        mc = self.cfg["mqtt"]
        self.host = str(os.environ.get("MQTT_HOST") or mc["host"])
        self.port = int(os.environ.get("MQTT_PORT") or mc["port"])
        self.prefix = f"agv/{self.id}"
        self.connected = threading.Event()
        self._last_path_t = 0.0
        self._last_path: list | None = None

        self.pub_cmd = self.create_publisher(String, "agv/command", EVENTS)
        self.pub_estop = self.create_publisher(Bool, "emergency_stop", LATCHED)
        self.create_subscription(String, "agv/state", lambda m: self._forward("telemetry", m), 10)
        self.create_subscription(String, "agv/robot_info", lambda m: self._forward("telemetry", m), 10)
        self.create_subscription(String, "agv/task_status", lambda m: self._forward("task", m, qos=1), EVENTS)
        self.create_subscription(String, "agv/events", lambda m: self._forward("emergency", m, qos=1), EVENTS)
        self.create_subscription(String, "agv/mission_events", lambda m: self._forward("emergency", m, qos=1), EVENTS)
        self.create_subscription(Path, "plan", self._on_plan, 1)

        cid = str(mc["client_id"]) or f"ros_bridge_{self.id}"
        self.client = make_client(cid)
        self.client.will_set(f"{self.prefix}/online", json.dumps({"online": False}), qos=1, retain=True)
        self.client.reconnect_delay_set(min_delay=1, max_delay=5)
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message
        self.get_logger().info(f"MQTT ブローカーへ接続します: {self.host}:{self.port}（車両 {self.id}）")
        self.client.connect_async(self.host, self.port, int(mc["keepalive"]))
        self.client.loop_start()

    def destroy_node(self):
        try:
            self.mqtt_pub("online", {"online": False}, qos=1, retain=True)
            self.client.disconnect()
            self.client.loop_stop()
        except Exception:
            pass
        return super().destroy_node()

    # ---- MQTT ----
    def _on_connect(self, client, userdata, flags, rc, properties=None):
        code = getattr(rc, "value", rc)
        if code != 0:
            self.get_logger().error(f"MQTT 接続失敗: {rc}")
            return
        client.subscribe(f"{self.prefix}/command", 1)
        client.subscribe("agv/broadcast/stop", 1)
        self.connected.set()
        self.mqtt_pub("online", {"online": True}, qos=1, retain=True)
        self.get_logger().info("MQTT 接続成功")

    def _on_disconnect(self, client, userdata, *args):
        self.connected.clear()
        self.get_logger().warn("MQTT 切断（自動で再接続します）")

    def _on_message(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode("utf-8")) if msg.payload else {}
        except Exception:
            self.get_logger().warn(f"JSON でないメッセージを無視: {msg.topic}")
            return
        if not isinstance(payload, dict):
            return
        self.handle_command(msg.topic, payload)

    def handle_command(self, topic: str, payload: dict) -> None:
        action = payload.get("action")
        if topic.endswith("broadcast/stop") or action == "EMERGENCY_STOP":
            self.get_logger().warn("緊急停止を受信")
            self.pub_estop.publish(Bool(data=True))
            payload = {**payload, "action": "EMERGENCY_STOP"}
        elif action == "CLEAR_EMERGENCY":
            self.get_logger().info("緊急停止の解除を受信")
            self.pub_estop.publish(Bool(data=False))
        self.pub_cmd.publish(json_msg(payload))

    def mqtt_pub(self, suffix: str, payload: dict, qos: int = 0, retain: bool = False) -> None:
        self.client.publish(f"{self.prefix}/{suffix}", json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                            qos=qos, retain=retain)

    # ---- ROS → MQTT ----
    def _forward(self, suffix: str, msg: String, qos: int = 0) -> None:
        d = parse_json(msg)
        if d:
            self.mqtt_pub(suffix, d, qos=qos)

    def _on_plan(self, msg: Path) -> None:
        now = time.time()
        if now - self._last_path_t < float(self.cfg["path_publish_s"]):
            return
        self._last_path_t = now
        k = max(1, int(self.cfg["path_stride"]))
        poses = msg.poses
        pts = [[round(p.pose.position.x, 2), round(p.pose.position.y, 2)] for p in poses[::k]]
        if poses and (len(poses) - 1) % k:
            last = poses[-1].pose.position
            pts.append([round(last.x, 2), round(last.y, 2)])
        if pts == self._last_path:
            return
        self._last_path = pts
        goal = None
        if poses:
            g = poses[-1].pose.position
            goal = {"x": round(g.x, 2), "y": round(g.y, 2)}
        self.mqtt_pub("path", {"points": pts, "goal": goal})


def main(args=None):
    rclpy.init(args=args)
    node = MqttBridge()
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
