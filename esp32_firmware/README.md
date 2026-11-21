# esp32_firmware — ESP32-C3（足回り・反射神経）

ラズパイから USB で受け取った「ハンドル・スロットル」の指令で、PCA9685 経由でサーボと ESC を動かします。

- 指令が **0.3 秒**来なければ自動停止（ラズパイ・USB が止まっても暴走しない）
- 非常停止（`$E` / 車体のボタン）はラッチ、`$C` で解除
- タミヤ等の ESC の「ブレーキ→後退」の2度押しを自動で行う
- 急発進しないよう加速を制限（減速・停止はすぐ）
- 超音波センサーで目の前に物があると前進だけ止める
- ジャイロ（BNO055 / MPU6050 自動判別）・電池電圧を 20Hz で送る

通信の決まりは [`docs/agv_protocol.md`](../docs/agv_protocol.md) の「3. シリアル通信」。

## 配線（ESP32-C3M-TRY）

この基板は、多くのピンが最初から基板の部品（ボタン・LED・OLED など）につながっています。I2C は基板の I2C（GPIO8・9）を使い、**基板の裏の CN7**（6つ穴。四角い穴が1段目）から取り出します。ピン配置は `src/config.h` にまとめてあります。

| ESP32-C3M-TRY | 接続先 | 備考 |
|---|---|---|
| USB Type-C | ラズパイの USB | 電源と通信。ラズパイから `/dev/ttyACM0` に見える |
| CN7 1段目 3V3 | PCA9685 VCC、BNO055 VIN | ロジック電源 |
| CN7 2段目 GND | PCA9685 GND、BNO055 GND | ESC の GND も PCA9685 を通して共通になる |
| CN7 3段目 SCL（GPIO9） | PCA9685 SCL、BNO055 SCL | I2C（並列でOK: PCA=0x40, BNO055=0x28/0x29。基板の OLED などとも重ならない） |
| CN7 4段目 SDA（GPIO8） | PCA9685 SDA、BNO055 SDA | I2C |
| CN7 5・6段目 | つながない | |
| CN5 D4・D5 | 超音波（任意。今は OFF） | **ECHO は 5V なので分圧必須**（ECHO—1kΩ—D5—2kΩ—GND）。`US_ENABLE` を 1 に |
| CN5 D4 | 走行用電池の分圧（任意。今は OFF） | 電池+ —10kΩ— D4 —3.3kΩ— GND。`VBAT_ENABLE` を 1 に。超音波とは同時に使えない |

**CN7 と PCA9685 は、ピンの並び順が違います**（CN7 は 3V3・GND・SCL・SDA、PCA9685 は GND・OE・SCL・SDA・VCC・V+）。名前を合わせてつないでください。PCA9685 の OE・V+ はつなぎません。

| PCA9685 | 接続先 |
|---|---|
| CH0 | ステアリングサーボ（3ピン。黒が GND の段） |
| CH1 | ESC（受信機に挿さっていた3ピン）。ESC の赤線（BEC 5V）がサーボの電源になる |
| 緑のネジ端子 V+ | つながない（ESC の BEC から給電されるため） |

使ってはいけないピン: GPIO12〜17（フラッシュ）、GPIO18・19（USB）。GPIO9 は BOOT ボタンと共用なので、動作中に BOOT ボタンを押さないでください（I2C が乱れます）。
ピンを変えたら `src/config.h` を直してください。

## 書き込み（VS Code + PlatformIO）

1. VS Code に拡張機能「PlatformIO IDE」を入れる
2. `esp32_firmware` フォルダを開く（PlatformIO が自動でライブラリを入れる）
3. ESP32 を USB で PC につなぎ、左下の「→」（Upload）
4. 「コンセント」（Monitor）で `$T,...` が流れてくれば OK

書き込めないとき: BOOT ボタンを押しながら RESET を押し、BOOT を離してからもう一度 Upload。

## 調整パラメータ

`src/params.h` に一覧があります。ラズパイの車両コンテナで `ros2 run agv_main esp32_console` を使うと、
`set steer_center_us 1530` → `save` のように書き換えられます（ESP32 内に保存され、電源を切っても残る）。
コンソールは車両の通常の起動（serial_bridge）と USB を取り合うので、先に `bash edge_ai/scripts/start_robot.sh stop` で止めてから使います（手順は「AGV 実機の接続・起動・試験手順」の試験1-1）。

PCA9685 のどのチャンネルにサーボ・ESC を挿したかは `ch_steer`（初期値 0）・`ch_esc`（初期値 1）で変えられます（挿し替え不要。例 `set ch_esc 0` → `set ch_steer 2` → `save`）。

最初に必ず確認するもの: `steer_center_us`（まっすぐ）、`steer_invert`（左右）、`thr_invert`（前後）、`max_thr`（出力上限。最初は低く）、`imu_yaw_sign`（車を左に回したときにヨー角が増えるか）。

## テスト（PC 上でロジックだけ）

```bash
bash test_host/run.sh      # g++ が必要（Windows なら WSL など）
```

チェックサム付き通信・パラメータ・ESC の2度押し後退・加速制限をテストします。
