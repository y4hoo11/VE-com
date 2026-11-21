// =====================================================================
//  drive.h … ステアリングサーボと ESC（走行モーター）の出力
//   - スロットル/ステアリング（‰）→ パルス幅 [us] への変換
//   - 急加速しないように少しずつ上げる（スルーレート制限）。減速・停止はすぐ
//   - タミヤ等の ESC は「前進→後退」にすると最初はブレーキになり、
//     ニュートラルに戻してもう一度後退を入れると後退する（2度押し）。それを自動でやる
// =====================================================================
#pragma once
#include <Arduino.h>

// パルス幅 [us] → PCA9685 のカウント（0〜4095）。周期 = (prescale+1) × 4096 / osc
uint16_t pcaUsToTicks(int us, uint32_t oscHz, uint8_t prescale);

class Drive {
 public:
  bool begin();                                    // 出力の初期化（PWM 基板が見つかれば true）
  void update(uint32_t nowMs, int steerPm, int thrPm);  // 毎ループ呼ぶ（目標値 ‰）
  void neutral(uint32_t nowMs);                    // 即ニュートラル（非常停止など）
  int appliedThr() const { return appliedThr_; }   // 実際に車が動く向きの出力（ブレーキ中は 0）
  int appliedSteer() const { return steer_; }
  bool reversing() const { return state_ == REVERSE; }
  bool ok() const { return ok_; }
  int steerUs() const { return steerUs_; }
  int escUs() const { return escUs_; }
  uint32_t i2cErrors() const { return i2cErrors_; }  // PCA9685 への書き込みに失敗した回数（配線ノイズの目安）

 private:
  enum State { NORMAL, BRAKE, REV_ARM, REVERSE };
  State state_ = NORMAL;
  uint32_t stateSince_ = 0;
  int lastDir_ = 0;          // 最後に動いた向き（+1 前進 / -1 後退 / 0 不明）
  float thr_ = 0;            // スルーレート制限後のスロットル（‰）
  int steer_ = 0;
  int appliedThr_ = 0;
  int steerUs_ = 1500;
  int escUs_ = 1500;
  uint32_t lastMs_ = 0;
  uint32_t lastWrite_ = 0;
  bool ok_ = false;
  int chSteer_ = -1;         // 最後に出力したチャンネル（変わったら前のチャンネルを止める）
  int chEsc_ = -1;
  uint8_t prescale_ = 131;   // PCA9685 に設定した分周比（50Hz）。毎回 I2C で読み直さない
  int outSteerUs_ = -1;      // 最後に PCA9685 へ書けた値（同じなら書かない）
  int outEscUs_ = -1;
  uint32_t lastRefresh_ = 0;
  uint32_t i2cErrors_ = 0;
  bool pwmOut(uint8_t ch, int us);

  int thrToUs(int thrPm) const;
  int steerToUs(int steerPm) const;
  void write(uint32_t nowMs, bool force);
};
