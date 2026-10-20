#include "protocol.h"

#include <string.h>

uint8_t xorChecksum(const char* s, size_t n) {
  uint8_t x = 0;
  for (size_t i = 0; i < n; i++) x ^= (uint8_t)s[i];
  return x;
}

static int hexVal(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  return -1;
}

bool LineReader::feed(char c) {
  if (c == '$') {  // 行の始まり（途中で始まり直しても OK）
    len_ = 0;
    buf_[len_++] = c;
    return false;
  }
  if (len_ == 0) return false;  // '$' を待っている
  if (c == '\r') return false;
  if (c != '\n') {
    if (len_ < sizeof(buf_) - 1) {
      buf_[len_++] = c;
    } else {
      len_ = 0;  // 長すぎる行は捨てる
      bad_++;
    }
    return false;
  }
  // 行末: $ ... * H H
  buf_[len_] = '\0';
  size_t n = len_;
  len_ = 0;
  char* star = strrchr(buf_, '*');
  if (!star || (size_t)(star - buf_) + 3 != n) {
    bad_++;
    return false;
  }
  int h1 = hexVal(star[1]), h2 = hexVal(star[2]);
  size_t bodyLen = star - buf_ - 1;
  if (h1 < 0 || h2 < 0 || xorChecksum(buf_ + 1, bodyLen) != (uint8_t)(h1 * 16 + h2)) {
    bad_++;
    return false;
  }
  memcpy(body_, buf_ + 1, bodyLen);
  body_[bodyLen] = '\0';
  return true;
}

void sendLine(const char* body) {
  char out[160];
  size_t n = strlen(body);
  if (n > sizeof(out) - 6) return;
  uint8_t cs = xorChecksum(body, n);
  int len = snprintf(out, sizeof(out), "$%s*%02X\n", body, cs);
  // USB が繋がっていない/ラズパイが読んでいないときに止まらないよう、空きがあるときだけ送る
  if (Serial.availableForWrite() >= len) {
    Serial.write((const uint8_t*)out, len);
  }
}

int splitFields(char* s, char** out, int maxFields) {
  int n = 0;
  char* p = s;
  while (n < maxFields) {
    out[n++] = p;
    char* comma = strchr(p, ',');
    if (!comma) break;
    *comma = '\0';
    p = comma + 1;
  }
  return n;
}
