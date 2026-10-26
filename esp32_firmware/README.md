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

| ESP32-C3 | 接続先 | 備考 |
|---|---|---|
| USB Type-C | ラズパイの USB | 電源と通信。ラズパイから `/dev/ttyACM0` に見える |
| 3.3V | PCA9685 VCC, ジャイロ VIN | ロジック電源 |
| GND | PCA9685 GND, ジャイロ GND, ESC の GND | **全部つなぐ（共通GND）** |
| GPIO4 | PCA9685 SDA, ジャイロ SDA | I2C（並列でOK: PCA=0x40, BNO055=0x28, MPU6050=0x68） |
| GPIO5 | PCA9685 SCL, ジャイロ SCL | I2C |
| GPIO6 | HC-SR04 TRIG | 超音波（任意） |
| GPIO7 | HC-SR04 ECHO | **5V 出力なので分圧必須**（ECHO—1kΩ—GPIO7—2kΩ—GND）か HC-SR04P を使う |
| GPIO3 | 走行用バッテリー（分圧） | バッテリー+ —10kΩ— GPIO3 —3.3kΩ— GND（任意） |
| GPIO1 | 非常停止ボタン（任意） | `config.h` の `ESTOP_ENABLE` を 1 に |

| PCA9685 | 接続先 |
|---|---|
| CH0 | ステアリングサーボ（3ピン） |
| CH1 | ESC（3ピン）。ESC の赤線（BEC 5V）がサーボの電源になる |
| 緑のネジ端子 V+ | つながない（ESC の BEC から給電されるため） |

使ってはいけないピン: GPIO2/8/9（起動モード）、GPIO12〜17（フラッシュ）、GPIO18/19（USB）。
ピンを変えたら `src/config.h` を直してください。

## 書き込み（VS Code + PlatformIO）

1. VS Code に拡張機能「PlatformIO IDE」を入れる
2. `esp32_firmware` フォルダを開く（PlatformIO が自動でライブラリを入れる）
3. ESP32 を USB で PC につなぎ、左下の「→」（Upload）
4. 「コンセント」（Monitor）で `$T,...` が流れてくれば OK

書き込めないとき: BOOT ボタンを押しながら RESET を押し、BOOT を離してからもう一度 Upload。

## 調整パラメータ

`src/params.h` に一覧があります。ラズパイで `python tools/esp32_console.py` を使うと、
`set steer_center_us 1530` → `save` のように書き換えられます（ESP32 内に保存され、電源を切っても残る）。

最初に必ず確認するもの: `steer_center_us`（まっすぐ）、`steer_invert`（左右）、`thr_invert`（前後）、`max_thr`（出力上限。最初は低く）。

## テスト（PC 上でロジックだけ）

```bash
bash test_host/run.sh      # g++ が必要（Windows なら WSL など）
```

チェックサム付き通信・パラメータ・ESC の2度押し後退・加速制限をテストします。
