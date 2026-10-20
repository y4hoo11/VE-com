// =====================================================================
//  protocol.h … ラズパイとのシリアル通信（docs/agv_protocol.md の「3. シリアル通信」）
//  1行1メッセージ:  $本文*HH\n   （HH = $ と * の間の XOR チェックサム）
// =====================================================================
#pragma once
#include <Arduino.h>

class LineReader {
 public:
  // 1文字ずつ入れて、1行そろったら true（本文が body に入る。チェックサムNGは false）
  bool feed(char c);
  const char* body() const { return body_; }
  uint32_t badCount() const { return bad_; }

 private:
  char buf_[128];
  char body_[128];
  size_t len_ = 0;
  uint32_t bad_ = 0;
};

uint8_t xorChecksum(const char* s, size_t n);

// "$本文*HH\n" を作って送る（送信バッファが足りないときは捨てる＝止まらない）
void sendLine(const char* body);

// "D,12,-300,250" をカンマで分ける。戻り値はフィールド数
int splitFields(char* s, char** out, int maxFields);
