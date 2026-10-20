# VE-con AGV システム全体の説明（PC1・ラズパイ・ESP32 編）

## 全体の構成

```
┌──────────── PC2: Web・配車（backend / frontend, 既存）──────────┐
│  React 画面 ⇔ Node.js(Express, Socket.IO, Prisma) ⇔ Mosquitto     │
└───────────────────────────────┬─────────────────────────────────┘
                                │ MQTT :1883（全員がこのブローカーにつなぐ）
┌───────────────────────────────┴─────────────────────────────────┐
│  PC1: ROS 2 Humble（edge_ai, ve_con_ros2 コンテナ）                │
│   Nav2: 自己位置推定(AMCL) → 経路計画(Smac Hybrid) → 走行制御(RPP)  │
│   mission_manager: タスク実行 ／ marker_localizer: ArUco で位置補正 │
│   mqtt_bridge: Web(MQTT) ⇔ ROS                                      │
└──────────────┬──────────────────────────────▲────────────────────┘
        /cmd_vel（速度指令）        /odom・/scan・カメラ映像  （Zenoh, TCP 7447）
┌──────────────▼──────────────────────────────┴────────────────────┐
│  ラズパイ: ROS 2（edge_ai, Docker）: serial_bridge（安全ガード）    │
│            rplidar_ros・camera_node                                 │
└──────────────┬───────────────────────────────────────────────────┘
               │ USB シリアル（$D,…*HH）
┌──────────────▼───────────────────────────────────────────────────┐
│  ESP32-C3（esp32_firmware, C++）: PWM出力・ESC制御・IMU・超音波      │
└──────────────┬───────────────────────────────────────────────────┘
               │ I2C → PCA9685 → サーボ / ESC → TT-02
```

「考える」のは PC1、「止まる」はどの層でもできる（下の層ほど速く確実に止まる）設計です。

| 層 | 止まる条件 | 反応の速さ |
|---|---|---|
| ESP32 | 指令が 0.3 秒来ない / 非常停止ボタン / 超音波で至近距離 | 数 ms |
| ラズパイ | LiDAR で進む方向に障害物 / Nav2 の指令(/cmd_vel)が 0.5 秒来ない / LiDAR 故障 / Web 緊急停止 | 50 ms |
| PC1 | Nav2 のコストマップで回避・減速 / 自己位置が不確か / 人を検知して減速（YOLO 有効時） | 100 ms |

## フォルダ

```
VE-con/
├── frontend/  backend/  shared/      ← 既存（PC2）
├── map/                              ← 地図の元データ（Nav2 用のコピーは agv_navigation/maps/）
├── edge_ai/          ★ PC1 とラズパイで動かす ROS 2（使い方は edge_ai/README.md）
│   ├── ros2_ws/src/agv_main        … ラズパイ側（serial_bridge など）と mqtt_bridge
│   ├── ros2_ws/src/agv_navigation  … Nav2 の設定・地図・地点・mission_manager
│   ├── ros2_ws/src/agv_vision      … ArUco マーカーで自己位置補正
│   ├── docker/                     … ラズパイ用 Docker・Zenoh
│   └── scripts/start_robot.sh      … ラズパイで起動
├── esp32_firmware/   ★ ESP32 に書き込む（PlatformIO）
└── docs/
    ├── agv_protocol.md        ★ 通信の決まり（全員が見る）
    ├── backend_integration.md ★ PC2 に足すもの
    └── system_overview.md     ★ このファイル
```

同じリポジトリですが、それぞれのフォルダのプログラムを、それぞれの機械で起動します。
`npm run dev`（ルート）では backend と frontend しか起動しないので、edge_ai があっても影響ありません。

## タスクが実行されるまでの流れ

1. Web でタスクを作って車両に割り当てる → backend が `agv/AGV-01/command` に `TASK_ASSIGN` を送る
2. PC1 の mqtt_bridge が受け取り、mission_manager が `startLocation` / `targetLocation` を `waypoints.yaml` で座標にする
3. mission_manager が Nav2 にゴールを送る。Nav2 が経路を計画し `/cmd_vel` を出す。進捗は `agv/AGV-01/task` へ
4. ラズパイの serial_bridge が安全チェックして ESP32 に送る → 車が動く
5. ラズパイが `/odom`・`/scan` を出す → AMCL が現在地を更新し、mission_manager が `telemetry` で Web に位置を送る
6. 目的地で荷降ろしが終わったら `COMPLETED`（backend に受け取り処理を足すと DB に反映: `backend_integration.md`）

## 立ち上げの順番（おすすめ）

| 段階 | やること | 必要なもの |
|---|---|---|
| 1 | **シミュレーターで一通り動かす**（`edge_ai/README.md` の 1章、`run_sim.sh`）。Web からタスクを出して仮想の車が動くところまで | PC だけ |
| 2 | `docs/backend_integration.md` を backend に入れる | PC2 |
| 3 | ESP32 に書き込み、ラズパイで `teleop_twist_keyboard` を使ってハンドル・スロットル・ジャイロを確認（タイヤを浮かせて） | ESP32, PCA9685, TT-02 |
| 4 | LiDAR の向き合わせ（`scan_check`）、速度の測定（`edge_ai/README.md` の 4章） | LiDAR |
| 5 | 実際の会場の地図を作る（下記）、`waypoints.yaml` を測り直す | |
| 6 | 低速（`nav2_params.yaml` の `desired_linear_vel: 0.3`）で1地点だけ GOTO → 慣れたらタスク | |
| 7 | ArUco マーカーを貼る、カメラのキャリブレーション | カメラ |

## 地図の作り方

今の `map/demo_map.pgm` は `map/generate_map.py` で作った練習用の地図です。実際の区画で走らせるには、
その区画の地図が要ります。方法は2つ:

- **手で描く（おすすめ・簡単）**: 区画の壁・棚を巻き尺で測り、`generate_map.py` を書き換えて同じ形の pgm を作る
  （1 ピクセル = 5cm。黒 = 壁、白 = 走れる所）。テープで区切っただけの区画なら、そのテープの位置を「壁」として描く
  ※ LiDAR は床のテープは見えません。自己位置推定には実際に立っている物（壁・棚・柱・段ボール等）が必要です。
  何も無い広い場所なら、区画の周りに低い板や段ボールを並べてください
- **LiDAR で地図を作る（SLAM）**: リポジトリの ROS 2（`edge_ai/`, Dockerfile の slam_toolbox）で作れます。
  作った `.pgm` / `.yaml` を `edge_ai/ros2_ws/src/agv_navigation/maps/` に置き、`map:=` で指定すれば使えます

## 決めたこと・前提

- PC1 もラズパイも ROS 2 Humble（チームの `docs/ros2_quickstart.md` の環境）。経路計画などは Nav2 に任せる
- 車輪エンコーダは無い前提（スロットルから速度を推定）。付けたら `ESP32 config.h` の `ENC_ENABLE` と
  `agv_main/config/robot.yaml` の `speed_model.ticks_per_meter` を設定すれば自動で使います
- PC1 を再起動しても、最後の位置（コンテナの `~/.ros/agv_state/`）から再開します。ただし実行中だったタスクは消えるので Web から出し直してください
