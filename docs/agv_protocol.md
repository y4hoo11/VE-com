# AGV 通信仕様書（PC2 ⇔ PC1 ⇔ ラズパイ ⇔ ESP32）

このファイルが「チーム全員の共通ルール」です。送るデータの形を変えるときは、
**必ずこのファイルを先に直してから** 各プログラムを直してください。

```
[PC2: Web/配車 (backend, Node.js)]
        │  MQTT (Mosquitto :1883)            ← この文書の 2章
        ▼
[PC1: ROS 2 (edge_ai)  mqtt_bridge / mission_manager / Nav2 / marker_localizer]
        │  ROS 2 トピック（Zenoh ブリッジ, TCP 7447）  ← edge_ai/README.md の 5章
        ▼
[ラズパイ: ROS 2 (edge_ai)  serial_bridge / rplidar_ros / camera_node]
        │  USBシリアル (/dev/ttyACM0, 1行テキスト + チェックサム)  ← この文書の 3章
        ▼
[ESP32-C3: 足回り (esp32_firmware, C++)] ── I2C ── PCA9685 ── サーボ / ESC
```

- MQTTブローカーは1つだけ（PC2の docker-compose の Mosquitto）。MQTT につなぐのは PC1 の `mqtt_bridge` だけ。
  ラズパイは MQTT を使わず、PC1 と ROS 2 のトピックでやり取りする。
- PC1 と PC2 は MQTT で繋がるので、**PC2 の既存コードはそのまま動く**（追加は `backend_integration.md` 参照）。
- PC1・ラズパイの中身（ROS 2 のトピック・起動方法）は `edge_ai/README.md` を参照。

---

## 1. 座標系

| 項目 | 内容 |
|---|---|
| 世界座標 | `map/demo_map.yaml` と同じ。単位 **m**。x=右, y=上（地図画像の上方向） |
| 原点 | yaml の `origin`（demo_map なら地図左下が (-5, -5)） |
| 向き θ | **rad**、+x 方向が 0、反時計回りが正（-π〜π） |
| 車体座標 | x=前, y=左, z=上（ROS と同じ） |

Webのマップ画像に描くときの変換（demo_map: 解像度0.05, 200x200px）:

```
px = (x - origin_x) / resolution
py = height_px - (y - origin_y) / resolution     // 画像は上が row 0 なので反転
```

---

## 2. MQTT トピック一覧

`{id}` は車両ID（例 `AGV-01`）。JSON はすべて UTF-8。

### 2-1. PC2 → 車両（既存 + 追加）: `agv/{id}/command`

PC1 の `mqtt_bridge` が受け取り、ROS の `agv/command` として `mission_manager` に渡します。
緊急停止・解除は `emergency_stop` トピックでラズパイの `serial_bridge` にもすぐ届きます。

| 種類 | JSON | 受け手 |
|---|---|---|
| タスク割当（既存） | `{"type":"TASK_ASSIGN","taskId":"…","taskTitle":"…","startLocation":"Dock-A","targetLocation":"Station-1"}` | PC1 |
| 緊急停止（既存） | `{"action":"EMERGENCY_STOP"}` | ラズパイ(即停止) + PC1(タスク一時停止) |
| 緊急解除（追加） | `{"action":"CLEAR_EMERGENCY"}` | ラズパイ + PC1 |
| 一時停止 / 再開 | `{"action":"PAUSE"}` / `{"action":"RESUME"}` | PC1 |
| タスク中止 | `{"action":"CANCEL_TASK"}` | PC1 |
| 地点へ移動 | `{"type":"GOTO","target":"Station-1"}` または `{"type":"GOTO","x":1.0,"y":2.0}` | PC1 |
| ホームへ戻る | `{"type":"RETURN_HOME"}` | PC1 |
| 現在地を手動設定 | `{"action":"SET_POSE","x":-4.0,"y":-4.0,"theta":0.0}` | PC1 |
| 荷積み/荷降ろし完了 | `{"action":"CONFIRM"}`（`wait_mode: confirm` のとき） | PC1 |
| 手動操縦（追加） | `{"action":"MANUAL_DRIVE","linear":0.2,"angular":0.0}` | PC1 |
| 地図の切り替え（追加） | `{"action":"SET_MAP","mapId":"warehouse_a"}`（ふつうは 2-8 の全車両向けを使う。1台だけ試すとき用） | PC1 |

`startLocation` / `targetLocation` は `edge_ai/ros2_ws/src/agv_navigation/config/waypoints.yaml` の名前（または別名）。
`"1.5,-2.0"` のような「x,y」文字列も使えます。

全車両一斉停止: `agv/broadcast/stop` に `{"action":"EMERGENCY_STOP"}`

#### 手動操縦 `MANUAL_DRIVE`

Web のキーボード操縦。キーを押している間、0.2 秒ごとに送る。キーを離したら `linear`・`angular` とも 0 を1回送る。

| 項目 | 内容 |
|---|---|
| `linear` | 前後の速さ [m/s]。前が＋ |
| `angular` | 回転 [rad/s]。左回りが＋（`/cmd_vel` と同じ向き） |

- PC1 の `mission_manager` が受け取り、`/cmd_vel` に流す（10Hz）
- 上限: 0.3 m/s・1.0 rad/s（`mission.yaml` の `manual`）。超えた値は上限に抑える
- **0.5 秒届かなければ止める**（Web やネットワークが落ちたとき）。PC1 が落ちたときは、ラズパイの `serial_bridge` が `/cmd_vel` の途切れで止める
- **タスク実行中（GOTO・RETURN_HOME を含む。待ち行列にあるときも）と緊急停止中は無視する**。操縦中にタスクが届いたら手動操縦を終えてタスクを始める
- LiDAR の安全ガード（ラズパイ）は手動操縦中も効く
- TT-02 は車なので**その場では回れない**。`linear` が 0 で `angular` だけ送ると、ハンドルを切るだけで動かない。
  また 0.12 m/s より遅い指令は 0.12 m/s に引き上げられる（遅すぎると止まってしまうため）
- 操縦中は telemetry の `mode` が `MANUAL` になる

### 2-2. 車両 → PC2: `agv/{id}/telemetry`（既存）

**部分更新**。PC2 の `mqttService.ts` は入っている項目だけ更新します。

| 送り手 | 周期 | JSON |
|---|---|---|
| PC1（mission_manager） | 2Hz | `{"x":-3.2,"y":-1.0,"theta":1.57,"status":"RUNNING","mapId":"demo_map","speed":0.4,"phase":"TO_TARGET","taskId":"…","goal":"Station-1","mode":"NAV","note":"","paused":false,"queued":0,"locQuality":0.92}` |
| ラズパイ（serial_bridge） | 1Hz | `{"battery":83,"name":"1号機","vbat":7.71,"piTemp":52.1,"esp32":true,"lidarHz":5.5}` |

どちらも PC1 の `mqtt_bridge` が同じトピックに出す（ラズパイの分は ROS 経由で PC1 に届いたもの）。

`status` は Prisma の `VehicleStatus` と同じ文字列だけ使う: `IDLE` `RUNNING` `CHARGING` `ERROR` `OFFLINE`

`paused`: PAUSE を受けてから RESUME までの間 `true`（タスクが無いときも）。

`mode`（PC1 がいま何をしているか）:

| mode | 意味 |
|---|---|
| `IDLE` | 何もしていない |
| `OFFLINE` | 車両（ラズパイ）からデータが来ていない |
| `MANUAL` | 手動操縦中（MANUAL_DRIVE） |
| `NAV` | Nav2 で移動中 |
| `WAIT` | 荷積み・荷降ろしの待ち |
| `PAUSED` | 移動の途中で一時停止中 |
| `HOLD` | 移動の途中で止まっている（緊急停止・自己位置不明・車両のデータなし。理由は `note`） |
| `RETRY_WAIT` | Nav2 が失敗したので、少し待ってやり直す |

### 2-3. 車両 → PC2: `agv/{id}/emergency`（既存）

主にラズパイが出す（ESP32 の異常もラズパイ経由でここに出る）。`source` が `pc1` のものは PC1 が出す。

```json
{"reason":"前方障害物で15秒停止中","code":"BLOCKED","source":"lidar","distance_mm":240}
```

| code | 意味 | ラッチ（解除操作が必要） |
|---|---|---|
| `WEB_ESTOP` | Webの緊急停止ボタン | する |
| `ESTOP_BUTTON` | 車体の非常停止ボタン | する |
| `US_STOP` | 超音波で至近距離（ESP32が停止） | しない（離れれば復帰） |
| `BLOCKED` | LiDARで前方障害物があり一定時間進めない | しない |
| `COMM_LOST` | PC1 からの指令が途切れた | しない |
| `ESP32_LOST` | ESP32 と通信できない | しない |
| `LIDAR_FAIL` | LiDAR 故障・未接続（安全のため走行不可） | しない |
| `PCA_FAIL` / `IMU_FAIL` | ESP32 が PWM 基板 / ジャイロを見つけられない | しない |
| `LOCALIZATION_LOST` | （PC1）自己位置が分からなくなった。マーカーが見える所へ動かすか、現在地を設定（SET_POSE） | しない |
| `BLOCKED`（source: pc1） | （PC1）経路上の障害物で 15 秒以上進めない（60 秒でタスク失敗） | しない |

「ラッチしない」ものは、原因がなくなると PC1 の telemetry の status が自動で ERROR 以外に戻ります。

### 2-4. PC1 → PC2: `agv/{id}/task`（追加。PC2 側の受信処理は `backend_integration.md`）

```json
{"taskId":"…","status":"IN_PROGRESS","phase":"TO_START","progress":35,"message":"Dock-A へ移動中"}
```

`status`: `IN_PROGRESS` `COMPLETED` `FAILED` `CANCELLED`（Prisma `TaskStatus` と同じ）

**GOTO / RETURN_HOME（Web のタスクではない単発の移動）** も同じトピックで知らせる。`taskId` が `null` で、`command` と `goal` が付く:

```json
{"taskId":null,"command":"GOTO","goal":"Station-1","status":"FAILED","phase":"GOTO","progress":0,"message":"Station-1 へ移動できませんでした（Nav2 が経路を見つけられない/進めない）"}
```

- `command`: `GOTO` / `RETURN_HOME`
- 行き先が waypoints に無いとき（GOTO の地点名・RETURN_HOME のホーム）は、受け取った時点で `FAILED`
- Nav2 が経路を見つけられない・進めないときは、やり直し（`nav.retries` 回）の後に `FAILED`
- 途中で 15 秒進めないときは、これまで通り emergency に `BLOCKED`（source: pc1）も出る
- **`taskId` が `null` のものは DB のタスクと結び付けないこと**（画面のお知らせ・ログ用）

### 2-5. PC1 → (Web): `agv/{id}/path`（任意・表示用）

```json
{"points":[[-4.0,-4.0],[-3.6,-3.2]],"goal":{"x":-3.0,"y":-1.0}}
```

Nav2 が計画した経路を間引いたもの（1秒に1回まで）。行き先の地点名は telemetry の `goal`。

### 2-6. 接続状態: `agv/{id}/online`

PC1 の `mqtt_bridge` が接続時に `{"online":true}` を retain で出す。切れると遺言（LWT）で `{"online":false}`。
車両（ラズパイ）からデータが来ていないときは telemetry の `status` が `OFFLINE` になる。

### 2-7. 車両 → (Web): `agv/{id}/clearance`（表示用）

障害物までの距離。車両詳細ページの「物理センサー（アラウンドビュー）」に出す。
ラズパイの `serial_bridge` が 1秒に5回（`robot.yaml` の `rates.clearance_hz`）出し、PC1 の `mqtt_bridge` がそのまま MQTT へ流す。QoS 0・retain なし。

```json
{"scan8":[0.35,1.2,null,0.7,1.6,null,0.95,1.8],"usFront":null}
```

- `scan8`: LiDAR を 8 方向に分けた、それぞれでいちばん近い物までの距離 [m]。並びは **[前, 左前, 左, 左後, 後, 右後, 右, 右前]**
  （前から反時計回りに 45° ずつ、各 ±22.5°）。物が見えない方向は `null`
- 距離は **車体の外形（`robot.yaml` の `vehicle.length`・`width` の長方形）から** 測る。車体の中に入る点（自分の反射）は数えない
- `usFront`: 前の超音波 [m]。付いていない（`US_ENABLE 0`）・範囲外は `null`
- LiDAR のデータが1秒より古いときは送らない（Web は3秒届かなければ「データなし」にする）
- telemetry の `scan8`・`usFront`（偽の PC1・デモが使う）と同じ形。backend は DB に保存せず、Socket.IO の `vehicle:clearance`（`{id, scan8, usFront}`）で画面に流すだけ

### （廃止）PC1 ⇔ ラズパイの MQTT・カメラの WebSocket

以前の Python 版にあった `agv/{id}/drive` `odom` `scan` `safety`、`ai/online`、
カメラの WebSocket（`:5000/ws/camera/...`）は使わなくなった。
代わりに ROS 2 のトピック（`/cmd_vel` `/odom` `/scan` `/agv/safety` `/camera/image_raw/compressed` など）を使う。
一覧は `edge_ai/README.md` の 5章。

マーカー解析つきのカメラ映像は `http://<PC1>:5000/video`（MJPEG）。Web では `<img src=…>` で表示できる。

### 2-8. PC2 → 全車両: `agv/config/map`（追加。retain）

使う地図（全車両共通）。Web の設定「使用する地図の切り替え」（DB の `system_settings` の `map.active`）が正本。

```json
{"mapId":"warehouse_a"}
```

- backend が **retain** で出す。出すのは「設定の変更が適用されたとき」と「MQTT につながったとき」。
  retain なので、あとから起動した車両もつないだ時点で受け取る
- PC1 の `mqtt_bridge` が受け取り、ROS の `agv/map_config`（ラッチ）で `mission_manager` に渡す（中身は SET_MAP と同じ扱い）
- `mapId` は地図ファイルの名前（`agv_navigation/maps/<mapId>.yaml`）。地点は `config/waypoints/<mapId>.yaml`（無ければ共通の `waypoints.yaml`）

PC1（mission_manager）の動き:

| 状況 | 動き | 2-9 の `state` |
|---|---|---|
| すでにその地図 | 何もしない | （送らない） |
| 起動時に `map:=` を指定した（開発用） | 切り替えない（`map:=` が優先） | `LOCKED` |
| タスク中・待ち行列あり・手動操縦中・走行中 | 止まるまで待ってから切り替える | `PENDING` → `CHANGED` |
| 地図ファイルが無い・Nav2 が読めない | 切り替えない（元の地図のまま） | `FAILED` |
| 止まっている | Nav2 の地図を読み直し（`/map_server/load_map`）、地点を入れ替え、新しい地図の `Home` に現在地を設定 | `CHANGED` |

- 切り替え後の現在地は新しい地図の `Home`（`localization.initial_pose`）。実機では、車両を `Home` に置いてから切り替えること。
  置いた場所が違うときは Web から「現在地を設定（SET_POSE）」する
- シミュレーターでは、仮想の世界の地図も切り替わり、車は `Home` に置き直される
- telemetry（2-2）の `mapId` も新しい地図になる。Web はこれを見て表示する地図を変える

### 2-9. PC1 → PC2: `agv/{id}/map`（追加）

地図の切り替えの結果。emergency（2-3）とは別のトピックにしてある（車両を ERROR にしないため）。

```json
{"state":"CHANGED","mapId":"warehouse_a","from":"demo_map","reason":"地図を warehouse_a に切り替えました"}
```

| state | 意味 | backend のログ |
|---|---|---|
| `PENDING` | 動いているので、止まるまで待っている | INFO |
| `CHANGED` | 切り替えた | INFO |
| `LOCKED` | 起動時に `map:=` を指定しているので切り替えない | WARN |
| `FAILED` | 切り替えられなかった（`reason` に理由） | ERROR |

---

## 3. シリアル通信（ラズパイ ⇔ ESP32）

- USB CDC（ESP32-C3 内蔵USB）、115200bps 指定（CDC なので実際は無関係）。
- 1行1メッセージ: `$本文*HH\n`。`HH` は `$` と `*` の間の全文字の XOR（16進大文字2桁, NMEA と同じ）。
- チェックサムが合わない行は捨てる。

### ラズパイ → ESP32

| コマンド | 例 | 意味 |
|---|---|---|
| `D,seq,steer,thr` | `$D,15,250,-300*45` | 走行指令。steer/thr は -1000〜1000（‰）。+steer=左 |
| `S` | `$S*53` | 通常停止（ニュートラル） |
| `E,code` | `$E,1*58` | 非常停止をラッチ（`C` まで動かない） |
| `C` | `$C*43` | 非常停止の解除 |
| `P,name,value` | `$P,steer_center_us,1520*2E` | パラメータ設定（RAM） |
| `W` | `$W*57` | パラメータを NVS に保存 |
| `R` | `$R*52` | パラメータ一覧を要求 → `$p,…` で返る |
| `Z` | `$Z*5A` | ヨー角を 0 にリセット＆ジャイロ零点補正（静止時に） |
| `V` | `$V*56` | バージョン要求 → `$I,…` |

### ESP32 → ラズパイ

| メッセージ | 内容 |
|---|---|
| `$T,ms,yaw_cdeg,gz_mdps,vbat_mv,us_mm,enc,flags,thr,steer,seq*HH` | 20Hz テレメトリ。yaw は 0.01度（反時計回り+）、gz は 0.001 deg/s、us_mm は超音波距離（未接続 -1）、enc はエンコーダ累積（未接続 -1）、thr/steer は実際に出力中の値（‰） |
| `$A,code,text*HH` | アラート（`BOOT` `ESTOP_BTN` `US_STOP` `US_CLEAR` `WD` `IMU_FAIL` `PCA_FAIL` `ESTOP` `CLEAR`） |
| `$I,fw,imu,pwm*HH` | 起動時/要求時の情報（例 `$I,1.0.0,BNO055,PCA9685`） |
| `$p,name,value*HH` | パラメータ1件 |

`flags`（ビット）: `1`=非常停止ラッチ中, `2`=指令タイムアウト中, `4`=超音波停止中, `8`=IMU正常, `16`=PWM正常, `32`=後退中

---

## 4. 車両の状態とWeb表示の対応

| 状況 | PC1 が出す status | Webの表示 |
|---|---|---|
| 待機中 | `IDLE` | 通常 |
| タスク実行中 / 移動中 | `RUNNING` | 通常 |
| 充電器の地点で待機 | `CHARGING` | 通常 |
| 非常停止・障害物で長時間停止 | `ERROR`（+ emergency トピック） | 赤く「緊急事態発生」 |
| ラズパイから3秒以上データなし | `OFFLINE` | 通常（OFFLINE） |
