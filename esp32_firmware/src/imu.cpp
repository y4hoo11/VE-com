#include "imu.h"

#include <Adafruit_BNO055.h>
#include <Wire.h>

#include "config.h"
#include "params.h"

static Adafruit_BNO055* bno = nullptr;

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
  bno = new Adafruit_BNO055(55, addr, &Wire);
  if (!bno->begin(OPERATION_MODE_IMUPLUS)) {
    delete bno;
    bno = nullptr;
    return false;
  }
  bno->setExtCrystalUse(true);
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
    imu::Vector<3> e = bno->getVector(Adafruit_BNO055::VECTOR_EULER);      // heading: 時計回り 0〜360
    imu::Vector<3> g = bno->getVector(Adafruit_BNO055::VECTOR_GYROSCOPE);  // [deg/s]
    float heading = e.x();
    if (isnan(heading)) {
      if (++failCount_ > 50) ok_ = false;
      return;
    }
    failCount_ = 0;
    if (first_) {
      lastHeading_ = heading;
      first_ = false;
    }
    float d = wrap180(heading - lastHeading_);  // 前回からの変化（359→1 のまたぎも OK）
    lastHeading_ = heading;
    yawAcc_ += -d * sign;                       // 時計回り → 反時計回り＋に変換
    gz_ = g.z() * sign;
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
