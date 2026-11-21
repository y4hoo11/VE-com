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

// I2C の線の上で返事をした機器のアドレスを "i2c:3C 38 40" の形で書く（配線チェック用）
//   基板に最初から載っている OLED(3C)・AHT21(38)・KXTJ3(0E/0F) も見えるので、
//   それらだけ見えて 40(PCA9685)・28/29(BNO055) が無ければ CN7 から先の配線、何も見えなければピン設定を疑う
static void i2cScan(char* out, size_t size) {
  size_t len = snprintf(out, size, "i2c:");
  int found = 0;
  for (uint8_t a = 0x08; a < 0x78 && len + 4 < size; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      len += snprintf(out + len, size - len, "%s%02X", found ? " " : "", a);
      found++;
    }
  }
  if (!found) snprintf(out + len, size - len, "none");
}

static void sendInfo() {
  char scan[100];
  i2cScan(scan, sizeof(scan));
  char b[150];
  snprintf(b, sizeof(b), "I,%s,%s,%s,%s", FW_VERSION, imu.name(),
           USE_PCA9685 ? (drive.ok() ? "PCA9685" : "PCA9685_NG") : "LEDC", scan);
  sendLine(b);
}

// I2C の線が「話の途中」で止まっている（どこかの機器が SDA を LOW のまま握っている）と、
// どの機器とも話せなくなる。ESP32 だけがリセットされたとき（USB の抜き挿しやポートを開いたとき）に起きる。
// SCL を最大 9 回動かして機器に SDA を離させ、最後に STOP を送って線を空きにする
static void i2cBusRecover() {
  pinMode(PIN_I2C_SDA, INPUT_PULLUP);
  pinMode(PIN_I2C_SCL, OUTPUT_OPEN_DRAIN);
  digitalWrite(PIN_I2C_SCL, HIGH);
  delayMicroseconds(10);
  for (int i = 0; i < 9 && digitalRead(PIN_I2C_SDA) == LOW; i++) {
    digitalWrite(PIN_I2C_SCL, LOW);
    delayMicroseconds(10);
    digitalWrite(PIN_I2C_SCL, HIGH);
    delayMicroseconds(10);
  }
  pinMode(PIN_I2C_SDA, OUTPUT_OPEN_DRAIN);  // STOP: SCL が HIGH の間に SDA を LOW → HIGH
  digitalWrite(PIN_I2C_SDA, LOW);
  delayMicroseconds(10);
  digitalWrite(PIN_I2C_SCL, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_I2C_SDA, HIGH);
  delayMicroseconds(10);
  pinMode(PIN_I2C_SDA, INPUT);
  pinMode(PIN_I2C_SCL, INPUT);
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
  i2cBusRecover();
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, I2C_FREQ);
  // 起動直後はニュートラル（ESC はニュートラル信号を受けて準備完了になる）
  bool pwmOk = drive.begin();
  // BNO055 は電源が入ってから約 0.65 秒は返事をしないので待つ（PCA9685 が見つからなかったときもここで再挑戦）
  delay(700);
  if (!pwmOk) pwmOk = drive.begin();
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

  // ---- 起動時に見つからなかった I2C 機器を探し直す（1 秒ごと）----
  //   PCA9685 が見つからないと信号が 1 本も出ず、ESC が「信号なし」で鳴り続けるため
  static uint32_t lastRetry = 0;
  if (now - lastRetry >= 1000) {
    lastRetry = now;
    // PCA9685 への書き込みの失敗が増えていたら知らせる（I2C の線のノイズ・接触不良の目安）
    static uint32_t lastErr = 0;
    if (drive.i2cErrors() != lastErr) {
      char t[16];
      snprintf(t, sizeof(t), "%lu", (unsigned long)drive.i2cErrors());
      alert("I2C_ERR", t);
      lastErr = drive.i2cErrors();
    }
    if (!drive.ok()) {
      if (drive.begin()) {
        alert("PCA_OK", "PCA9685 found");
        sendInfo();
      }
    } else if (!imu.ok() && cmdThr == 0 && drive.appliedThr() == 0) {
      // BNO055 の初期化は 1 秒近く止まるので、走っていないときだけ（見つからなければすぐ終わる）
      if (imu.begin()) {
        alert("IMU_OK", imu.name());
        sendInfo();
      }
    }
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
