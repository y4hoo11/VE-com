// =====================================================================
//  config.h  … ピン配置と機能の ON/OFF（配線を変えたらここを直す）
//
//  ESP32-C3 で使ってはいけないピン:
//    GPIO2 / GPIO8 / GPIO9 … 起動モードを決めるピン（ストラッピングピン）
//    GPIO12〜17           … 内部フラッシュ用
//    GPIO18 / GPIO19      … USB（ラズパイとの通信）
// =====================================================================
#pragma once

#define FW_VERSION "1.0.0"

// ---- I2C（PCA9685 とジャイロを同じ線に並列でつなぐ）----
#define PIN_I2C_SDA 4
#define PIN_I2C_SCL 5
#define I2C_FREQ 400000

// ---- PWM 出力 ----
// 1 = PCA9685 を使う（推奨）。0 = ESP32 から直接 PWM を出す（PCA9685 が無いとき）
#define USE_PCA9685 1
#define PCA9685_ADDR 0x40
#define PCA_CH_STEER 0          // PCA9685 のチャンネル: ステアリングサーボ
#define PCA_CH_ESC 1            // PCA9685 のチャンネル: ESC
#define PIN_PWM_STEER 0         // USE_PCA9685 = 0 のときの直接出力ピン
#define PIN_PWM_ESC 1

// ---- ジャイロ（自動判別: BNO055 → MPU6050 の順に探す）----
#define BNO055_ADDR_A 0x28
#define BNO055_ADDR_B 0x29
#define MPU6050_ADDR 0x68

// ---- 超音波センサー HC-SR04（前方の至近距離ストップ）----
// ※ HC-SR04 の ECHO は 5V 出力。ESP32-C3 は 5V に耐えられないので、必ず抵抗で分圧する
//   （例: ECHO —1kΩ— GPIO7 —2kΩ— GND）か、3.3V 版の HC-SR04P を使うこと
#define US_ENABLE 1
#define PIN_US_TRIG 6
#define PIN_US_ECHO 7

// ---- 走行用バッテリー電圧（7.2V → 抵抗で分圧して ADC へ）----
//   例: バッテリー+ —10kΩ— GPIO3 —3.3kΩ— GND   （8.4V → 約2.1V）
//   分圧比は params の vbat_scale で合わせる（テスターの値と比べて調整）
#define VBAT_ENABLE 1
#define PIN_VBAT 3

// ---- 車輪エンコーダ（任意。ホールセンサー等のパルスを数える）----
#define ENC_ENABLE 0
#define PIN_ENC 10

// ---- 車体の非常停止ボタン（任意）----
//   おすすめ: NC（普段は閉じている）ボタンを GPIO1 と GND の間に。押す or 断線で HIGH → 停止
#define ESTOP_ENABLE 0
#define PIN_ESTOP 1
#define ESTOP_ACTIVE_HIGH 1

// ---- 周期 ----
#define TELEMETRY_PERIOD_MS 50   // 20Hz
#define IMU_PERIOD_MS 10         // 100Hz
#define PWM_PERIOD_MS 20         // 50Hz（サーボの周期と同じ）
#define US_PERIOD_MS 60
