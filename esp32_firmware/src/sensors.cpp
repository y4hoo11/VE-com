#include "sensors.h"

#include "config.h"
#include "params.h"

namespace {
int usMm = -1;
#if US_ENABLE
// ---- 超音波（割り込みでエコーの長さを測る → ループを止めない）----
volatile uint32_t echoStart = 0;
volatile uint32_t echoWidth = 0;
volatile bool echoDone = false;
uint32_t lastTrigMs = 0;
int usMissCount = 0;
bool gotEcho = false;

void IRAM_ATTR onEcho() {
  if (digitalRead(PIN_US_ECHO)) {
    echoStart = micros();
  } else if (echoStart) {
    echoWidth = micros() - echoStart;
    echoDone = true;
  }
}
#endif

// ---- エンコーダ ----
#if ENC_ENABLE
volatile long encCount = 0;
void IRAM_ATTR onEnc() { encCount++; }
#endif

// ---- バッテリー ----
float vbatFilt = 0;
}  // namespace

namespace sensors {

void begin() {
#if US_ENABLE
  pinMode(PIN_US_TRIG, OUTPUT);
  digitalWrite(PIN_US_TRIG, LOW);
  pinMode(PIN_US_ECHO, INPUT);
  attachInterrupt(digitalPinToInterrupt(PIN_US_ECHO), onEcho, CHANGE);
#endif
#if ENC_ENABLE
  pinMode(PIN_ENC, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_ENC), onEnc, RISING);
#endif
#if ESTOP_ENABLE
  pinMode(PIN_ESTOP, INPUT_PULLUP);
#endif
#if VBAT_ENABLE
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_VBAT, ADC_11db);  // 〜2.5V くらいまで測れる
#endif
}

void update(uint32_t nowMs) {
#if US_ENABLE
  if (echoDone) {
    noInterrupts();
    uint32_t w = echoWidth;
    echoDone = false;
    echoStart = 0;
    interrupts();
    // 音速 343m/s、往復なので 0.1715 mm/us
    int mm = (int)(w * 0.1715f);
    usMm = (mm > 20 && mm < 4000) ? mm : -1;
    usMissCount = 0;
    gotEcho = true;
  }
  if (nowMs - lastTrigMs >= US_PERIOD_MS) {
    if (lastTrigMs != 0 && !gotEcho && ++usMissCount > 3) usMm = -1;  // 返事がない = 遠い or 未接続
    gotEcho = false;
    lastTrigMs = nowMs;
    echoStart = 0;
    digitalWrite(PIN_US_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(PIN_US_TRIG, LOW);
  }
#endif
#if VBAT_ENABLE
  static uint32_t lastAdc = 0;
  if (nowMs - lastAdc >= 20) {
    lastAdc = nowMs;
    float mv = analogReadMilliVolts(PIN_VBAT) * (P.vbat_scale / 1000.0f);
    vbatFilt = (vbatFilt == 0) ? mv : vbatFilt * 0.95f + mv * 0.05f;
  }
#endif
}

int ultrasonicMm() { return usMm; }

int batteryMv() { return (int)vbatFilt; }

long encoderCount() {
#if ENC_ENABLE
  noInterrupts();
  long c = encCount;
  interrupts();
  return c;
#else
  return -1;
#endif
}

bool estopPressed() {
#if ESTOP_ENABLE
  bool level = digitalRead(PIN_ESTOP);
  return ESTOP_ACTIVE_HIGH ? level : !level;
#else
  return false;
#endif
}

}  // namespace sensors
