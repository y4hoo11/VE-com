// =====================================================================
//  sensors.h … 超音波距離 / バッテリー電圧 / エンコーダ / 非常停止ボタン
// =====================================================================
#pragma once
#include <Arduino.h>

namespace sensors {
void begin();
void update(uint32_t nowMs);
int ultrasonicMm();      // 最新の距離 [mm]（未接続・範囲外は -1）
int batteryMv();         // 走行用バッテリー電圧 [mV]（未接続は 0）
long encoderCount();     // エンコーダの累積パルス（未使用は -1）
bool estopPressed();     // 非常停止ボタン
}  // namespace sensors
