// PC 上でファームウェアのロジックをテストするための、最小限の Arduino の代用品
#pragma once
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <algorithm>
#include <string>

using std::max;
using std::min;

extern uint32_t g_millis;
inline uint32_t millis() { return g_millis; }
inline uint32_t micros() { return g_millis * 1000; }
inline void delay(uint32_t) {}
inline void delayMicroseconds(uint32_t) {}

template <class T, class L, class H>
inline T constrain(T v, L lo, H hi) {
  return v < (T)lo ? (T)lo : (v > (T)hi ? (T)hi : v);
}

#define IRAM_ATTR
#define HIGH 1
#define LOW 0

struct SerialStub {
  std::string out;
  std::string in;
  size_t pos = 0;
  void begin(int) {}
  int available() { return (int)(in.size() - pos); }
  int read() { return pos < in.size() ? (unsigned char)in[pos++] : -1; }
  int availableForWrite() { return 1024; }
  size_t write(const uint8_t* b, size_t n) {
    out.append((const char*)b, n);
    return n;
  }
};
extern SerialStub Serial;
