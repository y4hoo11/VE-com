"""ラズパイ ⇔ ESP32 のシリアル通信の電文（docs/agv_protocol.md の「3. シリアル通信」）。

1行1メッセージ:  $本文*HH\\n   （HH = $ と * の間の全文字の XOR を16進2桁で）
"""
from __future__ import annotations

# ESP32 の flags ビット
FLAG_ESTOP = 1
FLAG_WATCHDOG = 2
FLAG_US_STOP = 4
FLAG_IMU_OK = 8
FLAG_PWM_OK = 16
FLAG_REVERSE = 32


def checksum(body: str) -> str:
    x = 0
    for ch in body.encode("ascii", errors="replace"):
        x ^= ch
    return f"{x:02X}"


def build(*fields) -> bytes:
    body = ",".join(str(f) for f in fields)
    return f"${body}*{checksum(body)}\n".encode("ascii")


def parse(line: str) -> list[str] | None:
    """'$T,1,2*HH' → ['T','1','2']。チェックサム不一致や形式違いは None。"""
    line = line.strip()
    if not line.startswith("$"):
        return None
    star = line.rfind("*")
    if star < 0 or len(line) < star + 3:
        return None
    body, cs = line[1:star], line[star + 1:star + 3]
    if checksum(body).upper() != cs.upper():
        return None
    return body.split(",")


def drive(seq: int, steer: float, throttle: float) -> bytes:
    s = int(round(max(-1.0, min(1.0, steer)) * 1000))
    t = int(round(max(-1.0, min(1.0, throttle)) * 1000))
    return build("D", seq % 100000, s, t)


def parse_telemetry(f: list[str]) -> dict | None:
    """['T', ms, yaw_cdeg, gz_mdps, vbat_mv, us_mm, enc, flags, thr, steer, seq] → dict"""
    if len(f) < 11 or f[0] != "T":
        return None
    try:
        flags = int(f[7])
        return {
            "ms": int(f[1]),
            "yaw_deg": int(f[2]) / 100.0,
            "gz_dps": int(f[3]) / 1000.0,
            "vbat": int(f[4]) / 1000.0,
            "us_mm": int(f[5]),
            "enc": int(f[6]),
            "flags": flags,
            "estop": bool(flags & FLAG_ESTOP),
            "watchdog": bool(flags & FLAG_WATCHDOG),
            "us_stop": bool(flags & FLAG_US_STOP),
            "imu_ok": bool(flags & FLAG_IMU_OK),
            "pwm_ok": bool(flags & FLAG_PWM_OK),
            "thr": int(f[8]) / 1000.0,
            "steer": int(f[9]) / 1000.0,
            "seq": int(f[10]),
        }
    except ValueError:
        return None
