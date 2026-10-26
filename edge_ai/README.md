# edge_ai — AGV の頭脳（PC1）と車両（ラズパイ）を ROS 2 で動かす

ROS 2 **Humble** と **Nav2** を使う。チームの `docs/ros2_quickstart.md`（Docker + Nav2 + TurtleBot3 のシミュレーター）と同じ環境の上に、
TT-02 用のパッケージを足した。

```
[PC2: Web / 配車 (backend)] ── MQTT (Mosquitto :1883) ──┐   ← MQTT の形は今まで通り（docs/agv_protocol.md 2-1〜2-5）
                                                        │
[PC1: ve_con_ros2 コンテナ]                              │
   mqtt_bridge  ◄──────────────────────────────────────┘
   mission_manager ── navigate_to_pose ──► Nav2（AMCL・Smac Hybrid・Regulated Pure Pursuit・map_server …）
   marker_localizer（ArUco で AMCL を補正）                     │ /cmd_vel
        ▲ camera/image_raw/compressed                         ▼
        │                ┌──── Zenoh ブリッジ（TCP 7447, Wi-Fi）────┐
[ラズパイ: agv_robot コンテナ]                                       │
   camera_node   rplidar_ros (/scan)   serial_bridge ◄──────────────┘
                                          │ USB シリアル（$D / $T …、docs/agv_protocol.md 3章）
[ESP32-C3: esp32_firmware]  ── PCA9685 ── サーボ / ESC     ※ESP32 のファームは今まで通り
```

## パッケージ

| パッケージ | 動く場所 | 中身 |
|---|---|---|
| `agv_main` | ラズパイ / PC1 | `serial_bridge`（/cmd_vel → ESP32、安全ガード、/odom）、`lidar_node`（予備の LiDAR ドライバ）、`camera_node`、`sim_robot`（仮想の TT-02）、`mqtt_bridge`（PC1: Web ⇔ ROS）、`auto_drive`（元のデモ） |
| `agv_navigation` | PC1 | Nav2 の設定（TT-02 用）、地図、地点（waypoints）、`mission_manager`（タスク → Nav2 のゴール）、launch |
| `agv_vision` | PC1 | `marker_localizer`（ArUco マーカーで自己位置を補正、任意で YOLO で人を見て減速） |

### 前の Python 版（ai_server / robot_brain）との対応

| 前（自作） | 今（ROS 2） |
|---|---|
| パーティクルフィルタ（localization.py） | **AMCL**（Nav2） |
| A* 経路計画（planner.py） | **Smac Planner Hybrid-A\***（Reeds-Shepp: 切り返しのある車の経路） |
| Pure Pursuit（controller.py） | **Regulated Pure Pursuit**（後退あり・その場旋回なし） |
| 詰まったときの後退（vehicle_brain.py） | Nav2 の行動ツリー（`behavior_trees/navigate_ackermann.xml`: コストマップ消去 → 後退 → 待つ） |
| タスク手順・Web への進み具合（task_executor.py） | `mission_manager`（同じ手順・同じ MQTT の形） |
| ArUco で粒子を補正 | `marker_localizer` が AMCL に `initialpose` で教え直す |
| ラズパイの安全ガード・ESP32 中継（robot_brain） | `serial_bridge`（同じ安全ガードをそのまま使用） |
| PC1 ⇔ ラズパイの MQTT（drive / odom / scan） | ROS トピック（/cmd_vel, /odom, /scan）＋ Zenoh |
| カメラの WebSocket 送信 | `camera/image_raw/compressed` |
| 自作シミュレーター | `sim_robot`（Nav2 から見ると本物の車と同じ） |
| monitor.html | RViz（nav2_bringup の画面） |

ESP32 のファーム（`esp32_firmware/`）とシリアル通信の形は変えていない。

---

## 1. まず試す: シミュレーター（実機なし・PC1 だけ）

`docs/ros2_quickstart.md` の手順 1〜3（コンテナ起動と画面の確認）ができていれば動く。

```bash
docker exec -it ve_con_ros2 bash
bash /workspace/ros2_ws/run_sim.sh
```

- RViz が開き、地図の左下（Home）に車が出る（初期位置は mission_manager が自動で AMCL に教える）
- RViz の **Nav2 Goal** でゴールを置くと、切り返しを使いながら走る
- Web と同じ形のタスクを送る（別のターミナルで）:

```bash
docker exec -it ve_con_ros2 bash
source /workspace/ros2_ws/install/setup.bash
ros2 run agv_navigation send_task task Dock-A Station-1     # TASK_ASSIGN
ros2 run agv_navigation send_task watch                     # MQTT に何が出ているか見る
ros2 run agv_navigation send_task estop / clear / pause / resume / home
```

`send_task` は compose の Mosquitto（ホスト名 `mosquitto`）を使う。別の PC の Mosquitto なら `--host 192.168.x.x`。

障害物を置く: `bash /workspace/ros2_ws/run_sim.sh obstacles:="-2.0,-3.0,0.25"`（x, y, 半径。`;` で複数）

---

## 2. 実機: PC1

1. main ブランチの `docker-compose.yml` に **Zenoh ブリッジ**を重ねて起動する（ラズパイとつなぐため）:

   ```shell
   docker compose -f docker-compose.yml -f edge_ai/docker/docker-compose.pc1-zenoh.yml up -d --build
   ```

   - Windows のファイアウォールで **TCP 7447**（Zenoh）と **TCP 5000**（マーカー解析つき映像）を許可する
   - このファイルは `ros2_dev` に `NET_ADMIN` も足す（`run_pc1.sh` がコンテナの localhost でマルチキャストを使えるようにする。
     `ROS_LOCALHOST_ONLY=1` のままだと、ノードが多いときに見つけ合えないことがあるため）。
     シミュレーターだけのときも、このファイルを重ねて起動しておくと安心
   - なぜ Zenoh か: ROS 2 の DDS はマルチキャストで相手を探すが、Docker Desktop の中からは外に届かない。
     Zenoh は TCP 1本でつなぐので、`ROS_LOCALHOST_ONLY=1` のまま使える

2. 起動:

   ```bash
   docker exec -it ve_con_ros2 bash
   bash /workspace/ros2_ws/run_pc1.sh
   ```

   Mosquitto が別の PC（PC2）にあるときは `run_pc1.sh mqtt_host:=192.168.1.100`、または
   `agv_navigation/config/mission.yaml` の `mqtt.host` を書き換える。

## 3. 実機: ラズパイ

Raspberry Pi OS（64bit, Bookworm）のまま、ROS 2 は Docker で動かす（Ubuntu を入れ直さなくてよい）。

### 準備（最初の1回）

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER      # 入り直す
# リポジトリ
git clone https://github.com/y4hoo11/VE-con.git ~/VE-con && cd ~/VE-con
cp edge_ai/docker/robot.env.example edge_ai/docker/.env
nano edge_ai/docker/.env            # PC1_IP と AGV_ID を書く
# Pi Camera（CSI）を使うなら: ホスト側で MJPEG 配信を動かす（コンテナの camera_node がそれを読む）
sudo apt install -y python3-picamera2
sudo cp edge_ai/docker/pi-camera-relay.service /etc/systemd/system/   # 中のパス・ユーザー名を直してから
sudo systemctl enable --now pi-camera-relay
```

- `eclipse/zenoh-bridge-ros2dds` の Docker イメージが ARM64 で取れないときは、
  [GitHub のリリース](https://github.com/eclipse-zenoh/zenoh-plugin-ros2dds/releases) から aarch64 版の
  `zenoh-bridge-ros2dds` を取って、`ROS_DOMAIN_ID=30 ROS_LOCALHOST_ONLY=1 ./zenoh-bridge-ros2dds -e tcp/<PC1_IP>:7447` で動かす

### 起動

```bash
bash edge_ai/scripts/start_robot.sh          # 起動（電源を入れ直しても自動で上がる）
bash edge_ai/scripts/start_robot.sh logs     # ログ
bash edge_ai/scripts/start_robot.sh stop
```

### 時計を合わせる（重要）

ラズパイと PC1 の時計が 0.3 秒以上ずれると、Nav2 が「TF が古い / 未来」と言って動かない。
インターネットにつながる場所なら自動で合う。つながらない工場 LAN では PC1 を時計の基準にする:

- PC1（Windows, 管理者の PowerShell）:
  ```powershell
  reg add HKLM\SYSTEM\CurrentControlSet\Services\W32Time\TimeProviders\NtpServer /v Enabled /t REG_DWORD /d 1 /f
  w32tm /config /reliable:yes /update; Restart-Service w32time
  ```
  （UDP 123 をファイアウォールで許可）
- ラズパイ: `/etc/systemd/timesyncd.conf` に `NTP=<PC1_IP>` と書いて `sudo systemctl restart systemd-timesyncd`

---

## 4. 実機で最初にやる調整

| 何を | どうやって | どこに書く |
|---|---|---|
| LiDAR の向き | 車の真正面 30〜50cm に箱を置き `ros2 run agv_main scan_check --ros-args --params-file /workspace/ros2_ws/src/agv_main/config/robot.yaml`（ラズパイのコンテナで） | `robot.yaml` の `laser.yaw_deg` |
| 速度（スロットル→m/s） | `ros2 run teleop_twist_keyboard teleop_twist_keyboard` で一定速度で走らせ、進んだ距離 ÷ 時間を測る | `robot.yaml` の `speed_model.gain_mps` |
| 最大舵角 | ハンドルいっぱいで円を描き、半径 R を測る → 舵角 = atan(0.257 / R) | `robot.yaml` の `vehicle.max_steer_deg` と `nav2_params.yaml` の `minimum_turning_radius` |
| ステア中立・ESC | `ros2 run agv_main esp32_console`（serial_bridge を止めてから） | ESP32 の NVS（`save`） |
| マーカー | `ros2 run agv_vision make_markers --size-mm 150` で印刷し、貼った位置を測る | `agv_vision/config/markers.yaml` |
| カメラの歪み | `ros2 run agv_vision grab_frames` で撮って `ros2 run agv_vision calibrate_camera ...` | `agv_main/config/camera_calib.yaml` |
| 地点 | 地図を変えたら `ros2 run agv_navigation check_waypoints` | `agv_navigation/config/waypoints.yaml` |

`ros2 run` はコンテナの中で（ラズパイ: `docker exec -it agv_robot bash`、PC1: `docker exec -it ve_con_ros2 bash`）、
先に `source /workspace/ros2_ws/install/setup.bash` してから。
teleop で走らせるときは PC1 の Nav2 を止めておく（両方から /cmd_vel が来るとぶつかる）。安全ガードは teleop でも効く。

## 5. トピック（ROS 2）

| トピック | 型 | 出す → 受ける |
|---|---|---|
| `/cmd_vel` | geometry_msgs/Twist | Nav2（velocity_smoother）→ serial_bridge |
| `/scan` | sensor_msgs/LaserScan | rplidar_ros → Nav2・AMCL・serial_bridge（安全ガード） |
| `/odom` + TF `odom→base_link` | nav_msgs/Odometry | serial_bridge → Nav2・AMCL |
| TF `map→odom` | | AMCL |
| TF `base_link→laser / camera_link / camera_optical_frame` | static | serial_bridge / sim_robot（値は robot.yaml の laser / camera_mount） |
| `/imu/data` `/battery_state` `/ultrasonic` | Imu / BatteryState / Range | serial_bridge |
| `/emergency_stop` | std_msgs/Bool（ラッチ） | mqtt_bridge → serial_bridge・mission_manager |
| `/agv/command` | String(JSON) | mqtt_bridge → mission_manager（Web のコマンドそのまま） |
| `/agv/state` | String(JSON) | mission_manager → mqtt_bridge → `agv/{id}/telemetry` |
| `/agv/robot_info` | String(JSON) | serial_bridge → mqtt_bridge → `agv/{id}/telemetry`（電池など） |
| `/agv/task_status` | String(JSON) | mission_manager → `agv/{id}/task` |
| `/agv/events` `/agv/mission_events` | String(JSON) | serial_bridge / mission_manager → `agv/{id}/emergency` |
| `/agv/safety` | String(JSON) | serial_bridge（安全ガードの状態） |
| `/plan` | nav_msgs/Path | Nav2 → mqtt_bridge → `agv/{id}/path` |
| `/initialpose` | PoseWithCovarianceStamped | mission_manager（起動時・SET_POSE）/ marker_localizer → AMCL |
| `/camera/image_raw/compressed` `/camera/camera_info` | | camera_node → marker_localizer |
| `/speed_limit` | nav2_msgs/SpeedLimit | marker_localizer（YOLO 有効時）→ Nav2 |

JSON をそのまま流すトピックは std_msgs/String にした（独自メッセージのパッケージを作らずに済み、MQTT の形と1対1になる）。

`docs/agv_protocol.md` のうち **2-6（PC1⇔ラズパイの MQTT）と 2-7（カメラの WebSocket）は ROS トピックに置き換わった**。
2-1〜2-5（Web との MQTT）と 3章（シリアル）はそのまま。

## 6. 安全のしくみ（二重・三重）

1. Nav2: コストマップで障害物を避ける・Regulated Pure Pursuit が衝突しそうなら減速
2. ラズパイの `serial_bridge`: LiDAR で進む方向（切った舵の円弧）を見て減速・停止。`/cmd_vel` が 0.5 秒途切れたら停止（走行中なら Web に COMM_LOST）。Wi-Fi や PC1 が落ちても効く
3. ESP32: 0.3 秒指令が来なければ停止、超音波で至近距離なら停止、非常停止ボタン

## 7. テスト

ROS が無くても動くテスト（判断部分・タスクの進め方・マーカーの計算）:

```bash
cd edge_ai/ros2_ws/src/agv_main && python3 -m pytest test -q        # pytest が無ければ python3 -m unittest discover -s test
cd ../agv_navigation && python3 -m pytest test -q
cd ../agv_vision && python3 -m pytest test -q
```

## 8. Git の注意（feature/tt-02 に置いた場合）

- `main` の `agv_main` には中身が空の `serial_bridge.py` / `mqtt_bridge.py` / `start_robot.sh` があるので、
  main をマージすると **`agv_main` の `setup.py` `package.xml` `serial_bridge.py` `mqtt_bridge.py` と `edge_ai/scripts/start_robot.sh` がぶつかる**。
  どれも **こちら（feature/tt-02 側）を採用**すればよい（`git checkout --ours <ファイル>`）。`auto_drive.py` は同じ内容なのでぶつからない。
- `docker-compose.yml` と `Dockerfile` は **main の方を使う**（このブランチでは触っていない）。
- 前の Python 版（ai_server / robot_brain）と esp32_firmware、docs の3ファイルは `git stash`（「一旦保存」）の中にある。
  ESP32 のファームは今後も使うので戻すこと。ai_server / robot_brain はこの ROS 版で置き換わった（比較用に残すかはお好みで）。
