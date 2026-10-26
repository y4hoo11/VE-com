// =====================================================================
//  VE-con AGV 足回りファームウェア（ESP32-C3 + PCA9685 + BNO055/MPU6050）
//
//  役割（「反射神経」担当）:
//   - ラズパイから来た走行指令（$D）でステアリングサーボと ESC を動かす
//   - 指令が 0.3 秒来なければ自動で停止（ラズパイや USB が止まっても暴走しない）
//   - 非常停止（$E / 車体のボタン）はラッチ。$C で解除するまで動かない
//   - 超音波センサーで目の前に物があれば前進だけ止める
//   - ジャイロの向き・バッテリー電圧などを 20Hz でラズパイに送る（$T）
//
//  通信仕様: docs/agv_protocol.md の「3. シリアル通信」
// =====================================================================
#include <Arduino.h>
#include <Wire.h>

#include "config.h"
#include "drive.h"
#include "imu.h"
#include "params.h"
#include "protocol.h"
#include "sensors.h"

static Drive drive;
static Imu imu;
static LineReader reader;

// 指令の状態
static int cmdSteer = 0;      // ‰
static int cmdThr = 0;        // ‰
static long lastSeq = 0;
static uint32_t lastCmdMs = 0;
static bool everCommanded = false;

// 安全の状態
static bool estopLatched = false;
static bool watchdogActive = true;
static bool usBlocking = false;
static bool estopBtnPrev = false;

static void alert(const char* code, const char* text) {
  char b[96];
  snprintf(b, sizeof(b), "A,%s,%s", code, text);
  sendLine(b);
}

static void sendInfo() {
  char b[96];
  snprintf(b, sizeof(b), "I,%s,%s,%s", FW_VERSION, imu.name(), USE_PCA9685 ? (drive.ok() ? "PCA9685" : "PCA9685_NG") : "LEDC");
  sendLine(b);
}

static void emitParam(const char* name, int32_t value) {
  char b[64];
  snprintf(b, sizeof(b), "p,%s,%ld", name, (long)value);
  sendLine(b);
}

static void handleCommand(char* body) {
  char* f[6];
  int n = splitFields(body, f, 6);
  if (n < 1 || strlen(f[0]) != 1) return;
  const uint32_t now = millis();
  switch (f[0][0]) {
    case 'D':  // D,seq,steer,thr
      if (n >= 4) {
        lastSeq = atol(f[1]);
        cmdSteer = constrain(atoi(f[2]), -1000, 1000);
        cmdThr = constrain(atoi(f[3]), -1000, 1000);
        lastCmdMs = now;
        everCommanded = true;
      }
      break;
    case 'S':  // 通常停止
      cmdThr = 0;
      lastCmdMs = now;
      everCommanded = true;
      break;
    case 'E':  // 非常停止ラッチ
      if (!estopLatched) alert("ESTOP", n >= 2 ? f[1] : "1");
      estopLatched = true;
      cmdThr = 0;
      drive.neutral(now);
      break;
    case 'C':  // 非常停止の解除
      if (estopLatched) alert("CLEAR", "");
      estopLatched = false;
      cmdThr = 0;
      break;
    case 'P':  // P,name,value
      if (n >= 3) {
        if (paramsSet(f[1], atol(f[2]))) {
          emitParam(f[1], atol(f[2]));
          if (!strcmp(f[1], "pca_osc_hz")) drive.begin();
        } else {
          alert("PARAM_NG", f[1]);
        }
      }
      break;
    case 'W':
      paramsSave();
      alert("SAVED", "");
      break;
    case 'R':
      paramsDump(emitParam);
      break;
    case 'Z':
      imu.zero();
      alert("ZEROED", "");
      break;
    case 'V':
      sendInfo();
      break;
  }
}

static void sendTelemetry(uint32_t now) {
  uint8_t flags = 0;
  if (estopLatched) flags |= 1;
  if (watchdogActive) flags |= 2;
  if (usBlocking) flags |= 4;
  if (imu.ok()) flags |= 8;
  if (drive.ok()) flags |= 16;
  if (drive.reversing()) flags |= 32;
  char b[128];
  snprintf(b, sizeof(b), "T,%lu,%ld,%ld,%d,%d,%ld,%u,%d,%d,%ld", (unsigned long)now,
           (long)lroundf(imu.yawDeg() * 100.0f), (long)lroundf(imu.gyroZdps() * 1000.0f), sensors::batteryMv(),
           sensors::ultrasonicMm(), sensors::encoderCount(), flags, drive.appliedThr(), drive.appliedSteer(), lastSeq);
  sendLine(b);
}

void setup() {
  Serial.begin(115200);
#if ARDUINO_USB_CDC_ON_BOOT && ARDUINO_USB_MODE
  Serial.setTxTimeoutMs(0);  // ラズパイが読んでいなくても止まらないように
#endif
  paramsLoad();
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, I2C_FREQ);
  // 起動直後はニュートラル（ESC はニュートラル信号を受けて準備完了になる）
  bool pwmOk = drive.begin();
  bool imuOk = imu.begin();
  sensors::begin();
  delay(200);
  alert("BOOT", FW_VERSION);
  if (!pwmOk) alert("PCA_FAIL", "PCA9685 not found on I2C");
  if (!imuOk) alert("IMU_FAIL", "no BNO055/MPU6050");
  sendInfo();
}

void loop() {
  const uint32_t now = millis();

  // ---- 受信 ----
  while (Serial.available() > 0) {
    if (reader.feed((char)Serial.read())) handleCommand((char*)reader.body());
  }

  // ---- センサー ----
  static uint32_t lastImu = 0;
  if (now - lastImu >= IMU_PERIOD_MS) {
    lastImu = now;
    imu.update(now);
  }
  sensors::update(now);

  // ---- 安全チェック ----
  bool btn = sensors::estopPressed();
  if (btn && !estopBtnPrev) {
    estopLatched = true;
    alert("ESTOP_BTN", "");
  }
  estopBtnPrev = btn;

  bool wd = !everCommanded || (now - lastCmdMs > (uint32_t)P.wd_ms);
  if (wd && !watchdogActive && cmdThr != 0) alert("WD", "command timeout");
  watchdogActive = wd;

  int thr = cmdThr;
  int steer = cmdSteer;
  if (estopLatched) {
    thr = 0;
    steer = 0;
  }
  if (watchdogActive) thr = 0;

  int us = sensors::ultrasonicMm();
  bool block = P.us_stop_mm > 0 && thr > 0 && us > 0 && us < P.us_stop_mm;
  if (block && !usBlocking) {
    char t[16];
    snprintf(t, sizeof(t), "%d", us);
    alert("US_STOP", t);
  }
  if (!block && usBlocking) alert("US_CLEAR", "");
  usBlocking = block;
  if (block) thr = 0;  // 前進だけ止める（後退で離れるのは OK）

  // ---- 出力 ----
  drive.update(now, steer, thr);  // 非常停止中は thr=0, steer=0 になっている

  // ---- テレメトリ ----
  static uint32_t lastTel = 0;
  if (now - lastTel >= TELEMETRY_PERIOD_MS) {
    lastTel = now;
    sendTelemetry(now);
  }
  delay(1);
}
