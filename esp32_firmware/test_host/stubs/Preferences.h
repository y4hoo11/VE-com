#pragma once
#include <stdint.h>

#include <map>
#include <string>
// NVS の代わり（メモリ上に保存）
extern std::map<std::string, int32_t> g_nvs;
struct Preferences {
  bool begin(const char*, bool) { return true; }
  void end() {}
  int32_t getInt(const char* k, int32_t def) {
    auto it = g_nvs.find(k);
    return it == g_nvs.end() ? def : it->second;
  }
  void putInt(const char* k, int32_t v) { g_nvs[k] = v; }
};
