"""serial_bridge（実機）と sim_robot（シミュレーター）に共通の ROS ノード部分。

購読:
  cmd_vel          geometry_msgs/Twist   Nav2（velocity_smoother）からの速度指令
  scan             sensor_msgs/LaserScan 安全ガード用（rplidar_ros / lidar_node / sim_robot）
  emergency_stop   std_msgs/Bool         true = 緊急停止（ラッチ）, false = 解除（mqtt_bridge が出す）
配信:
  odom             nav_msgs/Odometry     + TF odom→base_link
  imu/data         sensor_msgs/Imu       ESP32 の IMU（ヨー角・角速度）
  battery_state    sensor_msgs/BatteryState
  ultrasonic       sensor_msgs/Range     超音波（付いていれば）
  agv/safety       std_msgs/String(JSON) 安全ガードの状態（変化時 + 1Hz）
  agv/events       std_msgs/String(JSON) Web に知らせる異常（mqtt_bridge が agv/{id}/emergency へ）
  agv/robot_info   std_msgs/String(JSON) 電池・温度など 1Hz（mqtt_bridge が agv/{id}/telemetry へ）
サービス:
  zero_yaw         std_srvs/Trigger      IMU のヨー角を 0 に（止まっているときに）
静的 TF（robot.yaml の laser / camera_mount から）:
  base_link→laser, base_link→camera_link→camera_optical_frame
  （static_transform_publisher を別に3つ起動しないのは、DDS の参加者（プロセス）の数を減らすため）
"""
from __future__ import annotations

import math
import time
from collections import deque

from geometry_msgs.msg import TransformStamped, Twist
from nav_msgs.msg import Odometry
from rclpy.node import Node
from sensor_msgs.msg import BatteryState, Imu, LaserScan, Range
from std_msgs.msg import Bool, String
from std_srvs.srv import Trigger
from tf2_ros import StaticTransformBroadcaster, TransformBroadcaster

from .robot_core import ROBOT_DEFAULTS, RobotCore, deep_merge
from .ros_utils import EVENTS, LATCHED, SENSOR, declare_tree, json_msg, rpy_to_quat, set_quat
from .safety import CLEAR, ESTOP


def read_cpu_temp() -> float | None:
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            return round(int(f.read().strip()) / 1000.0, 1)
    except Exception:
        return None


class RobotBridgeBase(Node):
    """サブクラスで make_esp() を実装する（本物の Esp32Link か、シミュレーターの SimEsp32 を返す）。"""

    def __init__(self, node_name: str, extra_defaults: dict | None = None):
        super().__init__(node_name)
        self.cfg = declare_tree(self, deep_merge(ROBOT_DEFAULTS, extra_defaults or {}))
        self.core = RobotCore(self.cfg)
        self.frames = self.cfg["frames"]
        self.started_at = time.time()

        self._tel_q: deque = deque(maxlen=200)
        self._alert_q: deque = deque(maxlen=50)
        self.last_tel: dict | None = None
        self.vbat_ema: float | None = None
        self._seq = 0
        self._last_estop_send = 0.0
        self._esp_lost_reported = False
        self._us_reported = 0.0
        self._last_safety_key = None
        self._last_safety_pub = 0.0
        self._scan_times: deque = deque(maxlen=20)

        self.esp = self.make_esp()
        self.esp.on_telemetry = lambda t: self._tel_q.append((time.time(), t))
        self.esp.on_alert = lambda c, txt: self._alert_q.append((c, txt))

        # ---- 出力 ----
        self.pub_odom = self.create_publisher(Odometry, "odom", 10)
        self.pub_imu = self.create_publisher(Imu, "imu/data", 10)
        self.pub_batt = self.create_publisher(BatteryState, "battery_state", 5)
        self.pub_us = self.create_publisher(Range, "ultrasonic", 5)
        self.pub_safety = self.create_publisher(String, "agv/safety", LATCHED)
        self.pub_events = self.create_publisher(String, "agv/events", EVENTS)
        self.pub_info = self.create_publisher(String, "agv/robot_info", 5)
        self.tf_pub = TransformBroadcaster(self) if bool(self.cfg["publish_tf"]) else None
        if bool(self.cfg["publish_static_tf"]):
            self._publish_static_tf()

        # ---- 入力 ----
        self.create_subscription(Twist, "cmd_vel", self._on_cmd_vel, 10)
        self.create_subscription(LaserScan, "scan", self._on_scan, SENSOR)
        self.create_subscription(Bool, "emergency_stop", self._on_estop_topic, LATCHED)
        self.create_service(Trigger, "zero_yaw", self._on_zero_yaw)

        rates = self.cfg["rates"]
        self.create_timer(1.0 / float(rates["control_hz"]), self._control_tick)
        self.create_timer(1.0 / float(rates["info_hz"]), self._info_tick)

        self.esp.start()
        self.get_logger().info(f"{node_name} 起動: {self.cfg['agv_id']} ({self.cfg['name']})")

    # ------------------------------------------------------------------
    def _publish_static_tf(self) -> None:
        fr, lz, cm = self.frames, self.cfg["laser"], self.cfg["camera_mount"]
        stamp = self.get_clock().now().to_msg()

        def tf(parent, child, x, y, z, roll, pitch, yaw):
            t = TransformStamped()
            t.header.stamp = stamp
            t.header.frame_id = parent
            t.child_frame_id = child
            t.transform.translation.x, t.transform.translation.y, t.transform.translation.z = float(x), float(y), float(z)
            q = rpy_to_quat(roll, pitch, yaw)
            t.transform.rotation.x, t.transform.rotation.y, t.transform.rotation.z, t.transform.rotation.w = q
            return t
        self._static_tf = StaticTransformBroadcaster(self)
        self._static_tf.sendTransform([
            tf(fr["base"], fr["laser"], lz["x"], lz["y"], lz["z"], 0.0, 0.0, math.radians(float(lz["yaw_deg"]))),
            tf(fr["base"], fr["camera"], cm["x"], cm["y"], cm["z"], 0.0,
               math.radians(float(cm["pitch_deg"])), math.radians(float(cm["yaw_deg"]))),
            # カメラの光学座標（z が前, x が右, y が下）。ROS の決まりごと
            tf(fr["camera"], fr["camera_optical"], 0.0, 0.0, 0.0, -math.pi / 2, 0.0, -math.pi / 2),
        ])

    def make_esp(self):  # pragma: no cover - サブクラスで実装
        raise NotImplementedError

    def destroy_node(self):
        try:
            self.esp.send_stop()
            self.esp.stop()
        except Exception:
            pass
        return super().destroy_node()

    # ------------------------------------------------------------------
    #  入力
    # ------------------------------------------------------------------
    def _on_cmd_vel(self, msg: Twist) -> None:
        self.core.set_cmd_vel(msg.linear.x, msg.angular.z, time.time())

    def _on_scan(self, msg: LaserScan) -> None:
        now = time.time()
        self.core.set_scan(msg.ranges, msg.angle_min, msg.angle_increment, now)
        self._scan_times.append(now)

    def _on_estop_topic(self, msg: Bool) -> None:
        if msg.data:
            self._estop("WEB_ESTOP", "Web から緊急停止されました")
        else:
            if self.core.guard.estop_latched:
                self.get_logger().info("緊急停止を解除")
            self.core.clear_estop()
            self.esp.send_clear()
            self._publish_safety(force=True)

    def _on_zero_yaw(self, request, response):
        self.esp.zero_yaw()
        response.success = True
        response.message = "ヨー角を 0 にしました（車体を止めた状態で実行してください）"
        return response

    def _estop(self, code: str, reason: str) -> None:
        first = self.core.latch_estop(code, reason)
        self.esp.send_estop(1)
        self._last_estop_send = time.time()
        if first:
            self.get_logger().warn(f"緊急停止: {reason}")
            self._event({"code": code, "reason": reason, "source": "pi"})
        self._publish_safety(force=True)

    def _event(self, ev: dict) -> None:
        self.pub_events.publish(json_msg(ev))

    # ------------------------------------------------------------------
    #  制御周期
    # ------------------------------------------------------------------
    def _control_tick(self) -> None:
        now = time.time()
        try:
            self._handle_alerts(now)
            self._handle_telemetry()
            d = self.core.step(now)
            if d.kind == "estop":
                if now - self._last_estop_send > 0.5:
                    self.esp.send_estop(1)
                    self._last_estop_send = now
                else:
                    self.esp.send_stop()
            elif d.kind == "stop":
                self.esp.send_stop()
            else:
                self._seq += 1
                self.esp.send_drive(self._seq, d.steer, d.throttle)
            for ev in d.events:
                self.get_logger().warn(f"通知: {ev.get('code')} {ev.get('reason')}")
                self._event(ev)
            if self.esp.online:
                self._esp_lost_reported = False
            elif now - self.started_at > 5.0 and not self._esp_lost_reported:
                self._esp_lost_reported = True
                self._event({"code": "ESP32_LOST", "reason": "ESP32 と通信できません（USB接続を確認）", "source": "pi"})
            self._publish_safety()
        except Exception as e:  # 何があっても止める
            self.get_logger().error(f"制御ループでエラー: {e!r}")
            try:
                self.esp.send_stop()
            except Exception:
                pass

    def _handle_alerts(self, now: float) -> None:
        while self._alert_q:
            code, text = self._alert_q.popleft()
            self.get_logger().info(f"ESP32 アラート: {code} {text}")
            if code == "ESTOP_BTN":
                self._estop("ESTOP_BUTTON", "車体の非常停止ボタンが押されました")
            elif code == "US_STOP" and now - self._us_reported > 10.0:
                self._us_reported = now
                self._event({"code": "US_STOP", "reason": f"超音波センサーで至近距離に障害物 ({text}mm)", "source": "esp32"})
            elif code in ("PCA_FAIL", "IMU_FAIL"):
                self._event({"code": code, "reason": f"ESP32 の異常: {code} {text}", "source": "esp32"})
            elif code == "BOOT" and self.core.guard.estop_latched:
                self.esp.send_estop(1)   # ESP32 が再起動しても緊急停止を保つ

    def _handle_telemetry(self) -> None:
        updated = False
        t = None
        while self._tel_q:
            rx, t = self._tel_q.popleft()
            updated |= self.core.on_telemetry(t, rx)
            v = t.get("vbat", 0.0)
            if v and v > 1.0:
                self.vbat_ema = v if self.vbat_ema is None else 0.95 * self.vbat_ema + 0.05 * v
        if t is None:
            return
        self.last_tel = t
        stamp = self.get_clock().now().to_msg()
        if updated:
            self._publish_odom(stamp)
        self._publish_imu(stamp, t)
        if t.get("us_mm", -1) is not None:
            r = Range()
            r.header.stamp = stamp
            r.header.frame_id = self.frames["base"]
            r.radiation_type = Range.ULTRASOUND
            r.field_of_view = 0.5
            r.min_range = 0.02
            r.max_range = 4.0
            us = int(t.get("us_mm", -1))
            r.range = us / 1000.0 if us > 0 else math.inf
            self.pub_us.publish(r)

    def _publish_odom(self, stamp) -> None:
        s = self.core.odom.state
        o = Odometry()
        o.header.stamp = stamp
        o.header.frame_id = self.frames["odom"]
        o.child_frame_id = self.frames["base"]
        o.pose.pose.position.x = s.x
        o.pose.pose.position.y = s.y
        set_quat(o.pose.pose.orientation, s.yaw)
        o.twist.twist.linear.x = s.v
        o.twist.twist.angular.z = s.w
        # エンコーダが無いので、速度の誤差は大きめに見積もる
        pc = [0.0] * 36
        pc[0], pc[7], pc[14], pc[21], pc[28], pc[35] = 0.05, 0.05, 1e6, 1e6, 1e6, 0.03
        o.pose.covariance = pc
        tc = [0.0] * 36
        tc[0], tc[7], tc[14], tc[21], tc[28], tc[35] = 0.04, 1e-3, 1e6, 1e6, 1e6, 0.01
        o.twist.covariance = tc
        self.pub_odom.publish(o)
        if self.tf_pub is not None:
            tf = TransformStamped()
            tf.header.stamp = stamp
            tf.header.frame_id = self.frames["odom"]
            tf.child_frame_id = self.frames["base"]
            tf.transform.translation.x = s.x
            tf.transform.translation.y = s.y
            set_quat(tf.transform.rotation, s.yaw)
            self.tf_pub.sendTransform(tf)

    def _publish_imu(self, stamp, t: dict) -> None:
        if not t.get("imu_ok", False):
            return
        m = Imu()
        m.header.stamp = stamp
        m.header.frame_id = self.frames["base"]
        set_quat(m.orientation, math.radians(float(t["yaw_deg"])))
        m.orientation_covariance = [1e6, 0.0, 0.0, 0.0, 1e6, 0.0, 0.0, 0.0, 0.003]
        m.angular_velocity.z = math.radians(float(t.get("gz_dps", 0.0)))
        m.angular_velocity_covariance = [1e6, 0.0, 0.0, 0.0, 1e6, 0.0, 0.0, 0.0, 0.001]
        m.linear_acceleration_covariance = [-1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]  # 加速度は出していない
        self.pub_imu.publish(m)

    # ------------------------------------------------------------------
    #  状態の配信
    # ------------------------------------------------------------------
    def _publish_safety(self, force: bool = False) -> None:
        g = self.core.guard
        d = self.core.last
        res = d.result if d else None
        state = ESTOP if g.estop_latched else (res.state if res else CLEAR)
        reason = g.estop_reason if g.estop_latched else (res.reason if res else "")
        key = (state, reason.split(" ")[0] if reason else "")
        now = time.time()
        if not force and key == self._last_safety_key and now - self._last_safety_pub < 1.0:
            return
        self._last_safety_key = key
        self._last_safety_pub = now
        self.pub_safety.publish(json_msg({
            "state": state, "reason": reason, "latched": g.estop_latched, "code": g.estop_code,
            "front_mm": int((res.clearance if res else 5.0) * 1000),
            "steer": round(d.steer, 3) if d else 0.0, "throttle": round(d.throttle, 3) if d else 0.0,
        }))

    def battery_percent(self) -> int | None:
        if self.vbat_ema is None:
            return None
        b = self.cfg["battery"]
        lo, hi = float(b["empty_v"]), float(b["full_v"])
        return int(round(max(0.0, min(1.0, (self.vbat_ema - lo) / (hi - lo))) * 100))

    def lidar_hz(self) -> float:
        ts = list(self._scan_times)
        if len(ts) < 2 or time.time() - ts[-1] > 1.0:
            return 0.0
        return round((len(ts) - 1) / max(1e-3, ts[-1] - ts[0]), 1)

    def _info_tick(self) -> None:
        info = {"name": str(self.cfg["name"]), "esp32": bool(self.esp.online), "lidarHz": self.lidar_hz()}
        pct = self.battery_percent()
        if pct is not None:
            info["battery"] = pct
            info["vbat"] = round(self.vbat_ema, 2)
            bs = BatteryState()
            bs.header.stamp = self.get_clock().now().to_msg()
            bs.voltage = float(self.vbat_ema)
            bs.percentage = pct / 100.0
            bs.present = True
            bs.power_supply_technology = BatteryState.POWER_SUPPLY_TECHNOLOGY_NIMH
            self.pub_batt.publish(bs)
        temp = read_cpu_temp()
        if temp is not None:
            info["piTemp"] = temp
        if getattr(self.esp, "info", None):
            info["fw"] = ",".join(self.esp.info)
        info["odomDistance"] = round(self.core.odom.state.distance, 1)
        self.pub_info.publish(json_msg(info))
