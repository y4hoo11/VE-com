// =====================================================================
//  config.h  … ピン配置と機能の ON/OFF（配線を変えたらここを直す）
//
//  基板: MicroFan ESP32-C3M-TRY（取扱説明書 ESP32-C3M-TRY-R1）
//    この基板では、多くのピンが最初から基板の部品につながっている:
//      GPIO0 = 青LED / GPIO1 = 明るさセンサー / GPIO2・3・6 = ボタン SW1・SW2・SW3
//      GPIO4・5 = CN5（超音波用。電源は 5V）/ GPIO7 = CN3（サーボ用）/ GPIO10 = カラーLED（CN4）
//      GPIO8・9 = 基板の I2C（OLED・温湿度・加速度センサー）。裏の CN7 に 3V3・GND・SCL・SDA が出ている
//      GPIO20 = CN2 / GPIO21 = ブザー
//    使ってはいけないピン: GPIO12〜17（内部フラッシュ）、GPIO18・19（USB = ラズパイとの通信）
//    ※ GPIO9 は BOOT ボタン（SW4）と共用。動作中に押すと I2C が乱れるので押さない
// =====================================================================
#pragma once

#define FW_VERSION "1.0.0"

// ---- I2C（PCA9685 とジャイロを同じ線に並列でつなぐ）----
//   基板の I2C（裏の CN7: 1=3V3 2=GND 3=SCL 4=SDA）を使う。基板の OLED(0x3C)・AHT21(0x38)・
//   KXTJ3(0x0E/0x0F) も同じ線にいるが、PCA9685(0x40)・BNO055(0x28/0x29) とアドレスがぶつからない
#define PIN_I2C_SDA 8
#define PIN_I2C_SCL 9
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
//   使うかどうか検討中なので OFF。つなぐときは CN5（D4 = TRIG、D5 = ECHO）に挿して 1 にする
//   ※ HC-SR04 の ECHO は 5V 出力。ESP32-C3 は 5V に耐えられないので、ECHO を抵抗で分圧する
//     （ECHO —1kΩ— D5 —2kΩ— GND）。CN5 の電源は 5V なので HC-SR04P でも ECHO は 5V になる
//   ※ 何もつないでいないのに 1 にすると、ECHO のピンが浮いて「至近距離に障害物」と誤判定し、前進が止まることがある
#define US_ENABLE 0
#define PIN_US_TRIG 4
#define PIN_US_ECHO 5

// ---- 走行用バッテリー電圧（7.2V → 抵抗で分圧して ADC へ）----
//   例: バッテリー+ —10kΩ— D4 —3.3kΩ— GND   （8.4V → 約2.1V）。電圧を測れるのは GPIO0〜4 だけで、
//   この基板では GPIO0〜3 が基板の部品とつながっているため、空いている CN5 の D4 を使う
//   （超音波と同じピンなので、両方は使えない）。分圧をつないでから 1 にする
//   分圧比は params の vbat_scale で合わせる（テスターの値と比べて調整）
#define VBAT_ENABLE 0
#define PIN_VBAT 4

// ---- 車輪エンコーダ（任意。ホールセンサー等のパルスを数える）----
//   ※ GPIO10 は基板のカラーLED（CN4）とつながっている。使うときは別のピンを選ぶ
#define ENC_ENABLE 0
#define PIN_ENC 10

// ---- 車体の非常停止ボタン（任意）----
//   おすすめ: NC（普段は閉じている）ボタンを GPIO1 と GND の間に。押す or 断線で HIGH → 停止
//   ※ 今は使わない（ESTOP_ENABLE 0）。GPIO1 はこの基板では明るさセンサーとつながっている
#define ESTOP_ENABLE 0
#define PIN_ESTOP 1
#define ESTOP_ACTIVE_HIGH 1

#if US_ENABLE && VBAT_ENABLE && (PIN_VBAT == PIN_US_TRIG || PIN_VBAT == PIN_US_ECHO)
#error "超音波と電池電圧が同じピンを使っています。どちらかを 0 にするか、ピンを変えてください"
#endif

// ---- 周期 ----
#define TELEMETRY_PERIOD_MS 50   // 20Hz
#define IMU_PERIOD_MS 10         // 100Hz
#define PWM_PERIOD_MS 20         // 50Hz（サーボの周期と同じ）
#define US_PERIOD_MS 60
