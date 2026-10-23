"""Web（PC2）が無くても、PC2 と同じ形のコマンドを MQTT で送ってテストするツール。

    ros2 run agv_navigation send_task task Dock-A Station-1   # TASK_ASSIGN（出発地→目的地）
    ros2 run agv_navigation send_task goto Station-2          # GOTO
    ros2 run agv_navigation send_task estop / clear / pause / resume / cancel / home / confirm / relocalize
    ros2 run agv_navigation send_task pose -4 -4 0            # 現在地を設定（x y 向きdeg）
    ros2 run agv_navigation send_task watch                   # agv/# を全部表示（Ctrl+C で終了）

オプション: --host mosquitto（docker compose の中）/ 192.168.1.100 --id AGV-01
"""
from __future__ import annotations

import argparse
import json
import math
import os
import time
import uuid


def make_client(client_id: str):
    import paho.mqtt.client as mqtt
    try:
        return mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)
    except AttributeError:  # paho-mqtt 1.x
        return mqtt.Client(client_id=client_id)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd")
    ap.add_argument("args", nargs="*")
    ap.add_argument("--host", default=os.environ.get("MQTT_HOST", "mosquitto"))
    ap.add_argument("--port", type=int, default=1883)
    ap.add_argument("--id", default="AGV-01")
    a = ap.parse_args()

    c = make_client(f"send_task_{uuid.uuid4().hex[:6]}")
    c.connect(a.host, a.port, 30)
    topic = f"agv/{a.id}/command"

    if a.cmd == "watch":
        def on_msg(client, userdata, msg):
            print(f"{time.strftime('%H:%M:%S')} {msg.topic} {msg.payload.decode(errors='replace')}")
        c.on_message = on_msg
        c.subscribe("agv/#")
        c.subscribe("ai/#")
        try:
            c.loop_forever()
        except KeyboardInterrupt:
            return

    if a.cmd == "task":
        start, target = (a.args + [None, None])[:2]
        if target is None:
            start, target = None, start
        payload = {"type": "TASK_ASSIGN", "taskId": f"test-{uuid.uuid4().hex[:8]}", "taskTitle": f"テスト搬送 {start}→{target}",
                   "startLocation": start, "targetLocation": target}
    elif a.cmd == "goto":
        if len(a.args) >= 2:
            payload = {"type": "GOTO", "x": float(a.args[0]), "y": float(a.args[1])}
        else:
            payload = {"type": "GOTO", "target": a.args[0]}
    elif a.cmd == "pose":
        x, y = float(a.args[0]), float(a.args[1])
        th = math.radians(float(a.args[2])) if len(a.args) > 2 else 0.0
        payload = {"action": "SET_POSE", "x": x, "y": y, "theta": th}
    else:
        simple = {"estop": {"action": "EMERGENCY_STOP"}, "clear": {"action": "CLEAR_EMERGENCY"},
                  "pause": {"action": "PAUSE"}, "resume": {"action": "RESUME"}, "cancel": {"action": "CANCEL_TASK"},
                  "home": {"type": "RETURN_HOME"}, "confirm": {"action": "CONFIRM"},
                  "relocalize": {"action": "GLOBAL_LOCALIZE"}}
        if a.cmd not in simple:
            ap.error(f"不明なコマンド: {a.cmd}")
        payload = simple[a.cmd]

    c.loop_start()
    info = c.publish(topic, json.dumps(payload, ensure_ascii=False), qos=1)
    info.wait_for_publish(3)
    print(f"送信: {topic} {json.dumps(payload, ensure_ascii=False)}")
    c.loop_stop()
    c.disconnect()


if __name__ == "__main__":
    main()
