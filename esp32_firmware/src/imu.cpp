#include "imu.h"

#include <Wire.h>

#include "config.h"
#include "params.h"

// BNO055 はライブラリを使わず、レジスタを直接読み書きする。
// Adafruit_BNO055::begin() は、リセット後に「チップが返事するまで」終わりのないループで待つ。
// I2C が不安定だとそこで ESP32 が止まり、PCA9685 は最後の信号（走行中ならその速さ）を出し続けてしまうため。
static uint8_t bnoAddr = 0;
static const uint8_t BNO_CHIP_ID = 0x00, BNO_PAGE_ID = 0x07, BNO_GYR_X_LSB = 0x14, BNO_OPR_MODE = 0x3D,
                     BNO_PWR_MODE = 0x3E, BNO_SYS_TRIGGER = 0x3F;
static const uint8_t BNO_ID = 0xA0, MODE_CONFIG = 0x00, MODE_IMUPLUS = 0x08;

static bool bnoWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(bnoAddr);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

static bool bnoRead(uint8_t reg, uint8_t* buf, uint8_t n) {
  Wire.beginTransmission(bnoAddr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(bnoAddr, n) != n) return false;
  for (uint8_t i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}

static float wrap180(float a) {
  while (a > 180.0f) a -= 360.0f;
  while (a < -180.0f) a += 360.0f;
  return a;
}

static bool i2cPresent(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

bool Imu::begin() {
  if (i2cPresent(BNO055_ADDR_A) && beginBno(BNO055_ADDR_A)) return true;
  if (i2cPresent(BNO055_ADDR_B) && beginBno(BNO055_ADDR_B)) return true;
  if (i2cPresent(MPU6050_ADDR) && beginMpu()) return true;
  kind_ = NONE;
  name_ = "NONE";
  ok_ = false;
  return false;
}

bool Imu::beginBno(uint8_t addr) {
  bnoAddr = addr;
  uint8_t id = 0;
  if (!bnoRead(BNO_CHIP_ID, &id, 1) || id != BNO_ID) return false;
  // 設定モード → 通常電源 → ページ0 → 外部水晶 → IMUPLUS（ジャイロ＋加速度で向きを計算。地磁気は使わない）
  // どれか1つでも失敗したら諦める（待ち続けない）。全部で 0.1 秒くらい
  if (!bnoWrite(BNO_OPR_MODE, MODE_CONFIG)) return false;
  delay(25);
  if (!bnoWrite(BNO_PWR_MODE, 0x00) || !bnoWrite(BNO_PAGE_ID, 0x00)) return false;
  delay(10);
  if (!bnoWrite(BNO_SYS_TRIGGER, 0x80)) return false;
  delay(10);
  if (!bnoWrite(BNO_OPR_MODE, MODE_IMUPLUS)) return false;
  delay(20);
  kind_ = BNO055;
  name_ = "BNO055";
  ok_ = true;
  first_ = true;
  return true;
}

static void mpuWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

bool Imu::beginMpu() {
  mpuWrite(0x6B, 0x00);  // スリープ解除
  delay(50);
  mpuWrite(0x1A, 0x03);  // デジタルローパスフィルタ 44Hz
  mpuWrite(0x1B, 0x00);  // ジャイロ ±250 dps（131 LSB/dps）
  kind_ = MPU6050;
  name_ = "MPU6050";
  ok_ = true;
  calibrateMpu(300);
  lastUs_ = micros();
  return true;
}

bool Imu::readMpuGyroZ(float& dps) {
  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(0x47);  // GYRO_ZOUT_H
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)MPU6050_ADDR, (uint8_t)2) != 2) return false;
  int16_t raw = (int16_t)((Wire.read() << 8) | Wire.read());
  dps = raw / 131.0f;
  return true;
}

void Imu::calibrateMpu(int samples) {
  // 車が止まっている前提で、ジャイロの零点（バイアス）を測る
  float sum = 0;
  int n = 0;
  for (int i = 0; i < samples; i++) {
    float d;
    if (readMpuGyroZ(d)) {
      sum += d;
      n++;
    }
    delay(2);
  }
  bias_ = n ? sum / n : 0;
}

void Imu::zero() {
  if (kind_ == MPU6050) calibrateMpu(200);
  yawAcc_ = 0;
  yaw_ = 0;
  first_ = true;
}

void Imu::update(uint32_t nowMs) {
  (void)nowMs;
  if (!ok_) return;
  const float sign = (P.imu_yaw_sign >= 0) ? 1.0f : -1.0f;
  if (kind_ == BNO055) {
    // 0x14〜0x1B を一度に読む: ジャイロ X,Y,Z（16 LSB = 1 deg/s）、向き heading（16 LSB = 1 度、時計回り 0〜360）
    uint8_t b[8];
    if (!bnoRead(BNO_GYR_X_LSB, b, 8)) {
      if (++failCount_ > 50) ok_ = false;
      return;
    }
    failCount_ = 0;
    const float gzRaw = (int16_t)(b[4] | (b[5] << 8)) / 16.0f;
    const float heading = (int16_t)(b[6] | (b[7] << 8)) / 16.0f;
    if (first_) {
      lastHeading_ = heading;
      first_ = false;
    }
    float d = wrap180(heading - lastHeading_);  // 前回からの変化（359→1 のまたぎも OK）
    lastHeading_ = heading;
    yawAcc_ += -d * sign;                       // 時計回り → 反時計回り＋に変換
    gz_ = gzRaw * sign;
  } else if (kind_ == MPU6050) {
    float dps;
    uint32_t us = micros();
    float dt = (us - lastUs_) / 1e6f;
    lastUs_ = us;
    if (!readMpuGyroZ(dps)) {
      if (++failCount_ > 50) ok_ = false;
      return;
    }
    failCount_ = 0;
    dps -= bias_;
    if (fabsf(dps) < 0.15f) dps = 0;  // 止まっているときのノイズで回らないように
    gz_ = dps * sign;
    if (dt > 0 && dt < 0.2f) yawAcc_ += gz_ * dt;
  }
  yaw_ = wrap180(yawAcc_);
}
