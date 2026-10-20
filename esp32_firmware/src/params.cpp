#include "params.h"

#include <Preferences.h>
#include <string.h>

Params P;

namespace {
struct Entry {
  const char* name;  // NVS のキーは15文字まで
  int32_t* ptr;
};

Entry table[] = {
    {"steer_center_us", &P.steer_center_us}, {"steer_range_us", &P.steer_range_us},
    {"steer_invert", &P.steer_invert},       {"esc_neutral_us", &P.esc_neutral_us},
    {"esc_fwd_us", &P.esc_fwd_us},           {"esc_rev_us", &P.esc_rev_us},
    {"esc_deadband_us", &P.esc_deadband_us}, {"thr_invert", &P.thr_invert},
    {"esc_mode", &P.esc_mode},               {"brake_ms", &P.brake_ms},
    {"rev_arm_ms", &P.rev_arm_ms},           {"max_thr", &P.max_thr},
    {"thr_slew", &P.thr_slew},               {"wd_ms", &P.wd_ms},
    {"us_stop_mm", &P.us_stop_mm},           {"vbat_scale", &P.vbat_scale},
    {"imu_yaw_sign", &P.imu_yaw_sign},       {"pca_osc_hz", &P.pca_osc_hz},
};
const size_t N = sizeof(table) / sizeof(table[0]);

// 変な値で壊れないよう範囲を制限する
int32_t clampParam(const char* name, int32_t v) {
  if (!strcmp(name, "max_thr")) return constrain(v, 0, 1000);
  if (!strcmp(name, "wd_ms")) return constrain(v, 50, 2000);
  if (!strcmp(name, "steer_center_us") || !strcmp(name, "esc_neutral_us")) return constrain(v, 1000, 2000);
  if (!strcmp(name, "steer_range_us") || !strcmp(name, "esc_fwd_us") || !strcmp(name, "esc_rev_us"))
    return constrain(v, 0, 700);
  if (!strcmp(name, "esc_mode")) return constrain(v, 0, 2);
  return v;
}
}  // namespace

void paramsLoad() {
  Preferences pref;
  if (!pref.begin("agv", true)) return;  // まだ一度も保存していない
  for (size_t i = 0; i < N; i++) {
    *table[i].ptr = pref.getInt(table[i].name, *table[i].ptr);
  }
  pref.end();
}

void paramsSave() {
  Preferences pref;
  pref.begin("agv", false);
  for (size_t i = 0; i < N; i++) pref.putInt(table[i].name, *table[i].ptr);
  pref.end();
}

bool paramsSet(const char* name, int32_t value) {
  for (size_t i = 0; i < N; i++) {
    if (!strcmp(table[i].name, name)) {
      *table[i].ptr = clampParam(name, value);
      return true;
    }
  }
  return false;
}

void paramsDump(void (*emit)(const char* name, int32_t value)) {
  for (size_t i = 0; i < N; i++) emit(table[i].name, *table[i].ptr);
}
