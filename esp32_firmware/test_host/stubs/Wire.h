#pragma once
#include <stdint.h>
struct TwoWire {
  void beginTransmission(uint8_t) {}
  uint8_t endTransmission(bool = true) { return 0; }  // 0 = 機器が見つかった
};
extern TwoWire Wire;
