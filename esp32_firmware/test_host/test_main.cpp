// =====================================================================
//  PC 上で動かすファームウェアのロジックテスト（実機不要）
//    bash test_host/run.sh
//  テスト内容: チェックサム付き行の読み取り / パラメータ / ESC の2度押し後退 / 加速の制限
// =====================================================================
#include <assert.h>

#include <map>

#include "../src/config.h"
#include "../src/drive.h"
#include "../src/params.h"
#include "../src/protocol.h"
#include "Arduino.h"
#include "Wire.h"

uint32_t g_millis = 0;
SerialStub Serial;
TwoWire Wire;
std::map<std::string, int32_t> g_nvs;
int g_pwm_us[16];

static int fails = 0;
#define CHECK(cond)                                                     \
  do {                                                                  \
    if (!(cond)) {                                                      \
      printf("  NG  %s:%d  %s\n", __FILE__, __LINE__, #cond);           \
      fails++;                                                          \
    }                                                                   \
  } while (0)

static bool feedLine(LineReader& r, const char* s) {
  bool got = false;
  for (const char* p = s; *p; p++) got = r.feed(*p) || got;
  return got;
}

static void testProtocol() {
  printf("[protocol]\n");
  LineReader r;
  CHECK(feedLine(r, "$D,15,250,-300*45\n"));
  CHECK(strcmp(r.body(), "D,15,250,-300") == 0);
  CHECK(!feedLine(r, "$D,15,250,-300*46\n"));  // チェックサム違い
  CHECK(feedLine(r, "garbage$S*53\r\n"));      // 前にゴミがあっても読める
  CHECK(strcmp(r.body(), "S") == 0);
  char buf[] = "P,max_thr,500";
  char* f[6];
  int n = splitFields(buf, f, 6);
  CHECK(n == 3 && strcmp(f[1], "max_thr") == 0 && atoi(f[2]) == 500);
  Serial.out.clear();
  sendLine("A,BOOT,1.0.0");
  CHECK(Serial.out == "$A,BOOT,1.0.0*" + std::string(Serial.out.substr(14, 2)) + "\n");
  char cs[3];
  snprintf(cs, 3, "%02X", xorChecksum("A,BOOT,1.0.0", 12));
  CHECK(Serial.out.substr(14, 2) == cs);
}

static void testParams() {
  printf("[params]\n");
  CHECK(paramsSet("max_thr", 450) && P.max_thr == 450);
  CHECK(paramsSet("max_thr", 5000) && P.max_thr == 1000);  // 範囲制限
  CHECK(!paramsSet("no_such_param", 1));
  paramsSet("max_thr", 600);
  paramsSave();
  P.max_thr = 1;
  paramsLoad();
  CHECK(P.max_thr == 600);
}

// 指定時間 update を回す（10ms 刻み）
static void run(Drive& d, int ms, int steer, int thr) {
  for (int t = 0; t < ms; t += 10) {
    g_millis += 10;
    d.update(g_millis, steer, thr);
  }
}

static void testDrive() {
  printf("[drive]\n");
  P = Params();
  P.max_thr = 1000;
  Drive d;
  d.begin();
  CHECK(g_pwm_us[PCA_CH_ESC] == 1500 && g_pwm_us[PCA_CH_STEER] == 1500);

  // 加速はゆっくり（2000‰/s → 0.1秒で 200‰）
  run(d, 100, 0, 600);
  CHECK(d.appliedThr() > 150 && d.appliedThr() <= 220);
  run(d, 400, 0, 600);
  CHECK(d.appliedThr() == 600);
  CHECK(g_pwm_us[PCA_CH_ESC] > 1500);  // 前進
  // 停止はすぐ
  run(d, 20, 0, 0);
  CHECK(d.appliedThr() == 0 && g_pwm_us[PCA_CH_ESC] == 1500);

  // 前進のあとの後退: ブレーキ → ニュートラル → 後退
  run(d, 30, 0, -400);
  CHECK(d.appliedThr() == 0);                 // ブレーキ中は車は後ろに動かない
  CHECK(g_pwm_us[PCA_CH_ESC] < 1500);         // ブレーキのパルス（後退側）
  run(d, 150, 0, -400);
  CHECK(g_pwm_us[PCA_CH_ESC] == 1500);        // ニュートラル
  run(d, 300, 0, -400);
  CHECK(d.reversing() && d.appliedThr() < 0 && g_pwm_us[PCA_CH_ESC] < 1500);

  // 後退 → 止める → また後退: 今度はすぐ後退に入る
  run(d, 50, 0, 0);
  run(d, 30, 0, -400);
  CHECK(d.reversing());

  // ステアリング: + が左。center - range で 1100us
  run(d, 20, 1000, 0);
  CHECK(g_pwm_us[PCA_CH_STEER] == 1100);
  P.steer_invert = 1;
  run(d, 20, 1000, 0);
  CHECK(g_pwm_us[PCA_CH_STEER] == 1900);
  P.steer_invert = 0;

  // スロットル上限
  P.max_thr = 300;
  run(d, 1000, 0, 1000);
  CHECK(d.appliedThr() == 300);

  // 後退なしモード
  P.esc_mode = 2;
  run(d, 50, 0, 0);
  run(d, 500, 0, -500);
  CHECK(d.appliedThr() == 0 && g_pwm_us[PCA_CH_ESC] == 1500);
}

int main() {
  testProtocol();
  testParams();
  testDrive();
  if (fails) {
    printf("失敗 %d 件\n", fails);
    return 1;
  }
  printf("すべて成功\n");
  return 0;
}
