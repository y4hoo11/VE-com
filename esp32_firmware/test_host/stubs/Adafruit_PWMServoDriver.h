#pragma once
#include <stdint.h>

#include "Wire.h"
// PCA9685 の代わり: 最後に書いたパルス幅を覚えておく
extern int g_pwm_us[16];
struct Adafruit_PWMServoDriver {
  Adafruit_PWMServoDriver(uint8_t, TwoWire&) {}
  bool begin() { return true; }
  void setOscillatorFrequency(uint32_t) {}
  void setPWMFreq(float) {}
  void writeMicroseconds(uint8_t ch, uint16_t us) { g_pwm_us[ch] = us; }
};
