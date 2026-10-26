// =====================================================================
//  imu.h … ジャイロ（BNO055 または MPU6050 を自動で判別）
//   yaw: 反時計回り（左に曲がる）が + の角度 [deg]。起動時が 0
//   BNO055 … センサー内部で計算した向き（IMUPLUSモード: 地磁気なし＝モーターの磁気に強い）
//   MPU6050 … 角速度を積分して向きを出す（起動時に1秒静止して零点を測る。少しずつずれる）
// =====================================================================
#pragma once
#include <Arduino.h>

class Imu {
 public:
  bool begin();
  void update(uint32_t nowMs);
  void zero();            // 今の向きを 0 にする（＋MPU6050 は零点補正）
  float yawDeg() const { return yaw_; }       // -180〜180
  float gyroZdps() const { return gz_; }
  bool ok() const { return ok_; }
  const char* name() const { return name_; }

 private:
  enum Kind { NONE, BNO055, MPU6050 } kind_ = NONE;
  const char* name_ = "NONE";
  bool ok_ = false;
  float yaw_ = 0, gz_ = 0;
  float yawOffset_ = 0;
  float lastHeading_ = 0;
  float yawAcc_ = 0;      // 積算角（ラップしない）
  bool first_ = true;
  float bias_ = 0;
  uint32_t lastUs_ = 0;
  uint32_t failCount_ = 0;

  bool beginBno(uint8_t addr);
  bool beginMpu();
  void calibrateMpu(int samples);
  bool readMpuGyroZ(float& dps);
};
