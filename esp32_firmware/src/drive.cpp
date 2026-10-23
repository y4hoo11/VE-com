#include "drive.h"

#include <Wire.h>

#include "config.h"
#include "params.h"

#if USE_PCA9685
#include <Adafruit_PWMServoDriver.h>
static Adafruit_PWMServoDriver pca(PCA9685_ADDR, Wire);
#else
#include <esp_arduino_version.h>
#endif

static int sgn(float v) { return (v > 0) - (v < 0); }

bool Drive::begin() {
#if USE_PCA9685
  Wire.beginTransmission(PCA9685_ADDR);
  ok_ = (Wire.endTransmission() == 0);
  if (ok_) {
    pca.begin();
    pca.setOscillatorFrequency(P.pca_osc_hz);
    pca.setPWMFreq(50);  // RC サーボ / ESC は 50Hz
  }
#else
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(PIN_PWM_STEER, 50, 14);
  ledcAttach(PIN_PWM_ESC, 50, 14);
#else
  ledcSetup(0, 50, 14);
  ledcSetup(1, 50, 14);
  ledcAttachPin(PIN_PWM_STEER, 0);
  ledcAttachPin(PIN_PWM_ESC, 1);
#endif
  ok_ = true;
#endif
  neutral(millis());
  return ok_;
}

int Drive::steerToUs(int steerPm) const {
  int s = P.steer_invert ? -steerPm : steerPm;
  // + が左。サーボによっては逆なので steer_invert で合わせる
  return P.steer_center_us - (int)((long)s * P.steer_range_us / 1000);
}

int Drive::thrToUs(int thrPm) const {
  if (thrPm == 0) return P.esc_neutral_us;
  int t = P.thr_invert ? -thrPm : thrPm;
  int range = (t > 0) ? P.esc_fwd_us : P.esc_rev_us;
  int mag = P.esc_deadband_us + (int)((long)abs(t) * (range - P.esc_deadband_us) / 1000);
  return P.esc_neutral_us + (t > 0 ? mag : -mag);
}

void Drive::neutral(uint32_t nowMs) {
  thr_ = 0;
  appliedThr_ = 0;
  escUs_ = P.esc_neutral_us;
  if (state_ != REVERSE) state_ = NORMAL;
  write(nowMs, true);
}

void Drive::update(uint32_t nowMs, int steerPm, int thrPm) {
  float dt = (lastMs_ == 0) ? 0.0f : (nowMs - lastMs_) / 1000.0f;
  lastMs_ = nowMs;
  steer_ = constrain(steerPm, -1000, 1000);
  int target = constrain(thrPm, -(int)P.max_thr, (int)P.max_thr);
  if (P.esc_mode == 2 && target < 0) target = 0;  // 後退なし

  // ---- スルーレート制限（加速はゆっくり、減速・停止はすぐ）----
  if (target == 0 || (thr_ != 0 && sgn(target) != sgn(thr_))) {
    thr_ = 0;
  }
  if (abs(target) > fabsf(thr_)) {
    float step = P.thr_slew * dt;
    if (step <= 0) step = 1;
    thr_ += sgn(target) * min(step, (float)abs(target) - fabsf(thr_));
  } else {
    thr_ = target;
  }
  int cur = (int)thr_;

  // ---- ESC の状態（2度押し式の後退）----
  int out = cur;
  if (cur > 0) {
    state_ = NORMAL;
    lastDir_ = +1;
  } else if (cur == 0) {
    if (state_ == BRAKE || state_ == REV_ARM) state_ = NORMAL;
    if (state_ == REVERSE) state_ = NORMAL;  // 後退していた → 次の後退はすぐ入る（lastDir_ = -1）
  } else {  // cur < 0
    if (P.esc_mode != 0) {
      state_ = REVERSE;
    } else if (state_ == NORMAL) {
      if (lastDir_ == -1) {
        state_ = REVERSE;  // 直前も後退だった → そのまま後退
      } else {
        state_ = BRAKE;  // 1回目: ブレーキ
        stateSince_ = nowMs;
      }
    }
    if (state_ == BRAKE) {
      out = -max(500, abs(cur));
      if (nowMs - stateSince_ >= (uint32_t)P.brake_ms) {
        state_ = REV_ARM;
        stateSince_ = nowMs;
      }
    }
    if (state_ == REV_ARM) {
      out = 0;  // いったんニュートラル
      if (nowMs - stateSince_ >= (uint32_t)P.rev_arm_ms) state_ = REVERSE;
    }
    if (state_ == REVERSE) {
      out = cur;
      lastDir_ = -1;
    }
  }
  appliedThr_ = (state_ == BRAKE || state_ == REV_ARM) ? 0 : out;
  escUs_ = thrToUs(out);
  steerUs_ = steerToUs(steer_);
  write(nowMs, false);
}

void Drive::write(uint32_t nowMs, bool force) {
  if (!force && nowMs - lastWrite_ < PWM_PERIOD_MS) return;
  lastWrite_ = nowMs;
  steerUs_ = constrain(steerUs_, 900, 2100);
  escUs_ = constrain(escUs_, 900, 2100);
#if USE_PCA9685
  if (!ok_) return;
  pca.writeMicroseconds(PCA_CH_STEER, steerUs_);
  pca.writeMicroseconds(PCA_CH_ESC, escUs_);
#else
  const uint32_t full = (1 << 14) - 1;
  uint32_t dS = (uint32_t)((uint64_t)steerUs_ * full / 20000);
  uint32_t dE = (uint32_t)((uint64_t)escUs_ * full / 20000);
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(PIN_PWM_STEER, dS);
  ledcWrite(PIN_PWM_ESC, dE);
#else
  ledcWrite(0, dS);
  ledcWrite(1, dE);
#endif
#endif
}
