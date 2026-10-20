// =====================================================================
//  params.h … 調整用パラメータ（ラズパイから $P で変更、$W で保存）
//  例: ステアリングの中心がずれている → $P,steer_center_us,1530 → 確認 → $W
//  ※ robot_brain/tools/esp32_console.py を使うと簡単に変更できる
// =====================================================================
#pragma once
#include <Arduino.h>

struct Params {
  // ステアリングサーボ
  int32_t steer_center_us = 1500;  // まっすぐのときのパルス幅 [us]
  int32_t steer_range_us = 400;    // 最大舵角までの幅 [us]（1100〜1900us）
  int32_t steer_invert = 0;        // 1 = 左右が逆なら反転

  // ESC（スピードコントローラー）
  int32_t esc_neutral_us = 1500;   // 停止（ニュートラル）[us]
  int32_t esc_fwd_us = 500;        // 全開前進までの幅 [us]
  int32_t esc_rev_us = 500;        // 全開後退までの幅 [us]
  int32_t esc_deadband_us = 40;    // ESC が反応し始めるまでの幅 [us]
  int32_t thr_invert = 0;          // 1 = 前後が逆なら反転
  int32_t esc_mode = 0;            // 0=ブレーキ→後退の2度押し式(タミヤ等) 1=すぐ後退 2=後退なし
  int32_t brake_ms = 150;          // 2度押し式の1回目（ブレーキ）の長さ
  int32_t rev_arm_ms = 150;        // 2度押し式のニュートラルの長さ

  // 安全
  int32_t max_thr = 600;           // スロットル上限（‰）。最初は低めで！
  int32_t thr_slew = 2000;         // 加速の速さ（‰/秒）。0→全開 0.5秒
  int32_t wd_ms = 300;             // この時間指令が来なければ停止 [ms]
  int32_t us_stop_mm = 120;        // 超音波でこれより近いと前進停止（0 = 使わない）

  // センサー
  int32_t vbat_scale = 4030;       // 分圧比×1000（(R1+R2)/R2×1000。10k/3.3k なら 4030）
  int32_t imu_yaw_sign = 1;        // 左に曲がったときヨー角が増えなければ -1
  int32_t pca_osc_hz = 27000000;   // PCA9685 の発振周波数（個体差。パルス幅がずれるときに調整）
};

extern Params P;

void paramsLoad();
void paramsSave();
bool paramsSet(const char* name, int32_t value);
void paramsDump(void (*emit)(const char* name, int32_t value));
