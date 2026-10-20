"""ESP32 のパラメータを見たり変えたりするコンソール。

    ros2 run agv_main esp32_console                 （ポート自動検出）
    ros2 run agv_main esp32_console /dev/ttyACM0
    ※ serial_bridge が動いているとポートを取り合うので、先に止めてください
    > params                        一覧を表示
    > set steer_center_us 1530      変更（すぐ反映、電源を切ると戻る）
    > save                          ESP32 に保存（電源を切っても残る）
    > monitor                       テレメトリを 5 秒表示
    > zero / version / quit

パラメータの意味は esp32_firmware/src/params.h を参照。
"""
from __future__ import annotations

import sys
import time

from agv_main.esp32_link import Esp32Link


def main() -> None:
    port = sys.argv[1] if len(sys.argv) > 1 else "auto"
    last: dict = {}
    esp = Esp32Link(port, 115200,
                    on_telemetry=lambda t: last.update(t),
                    on_alert=lambda c, t: print(f"  [ESP32] {c} {t}"))
    esp.start()
    for _ in range(30):
        if esp.online:
            break
        time.sleep(0.1)
    print(f"ESP32: {esp.port} {'接続OK' if esp.online else '応答なし'}  情報: {','.join(esp.info)}")
    while True:
        try:
            line = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not line:
            continue
        parts = line.split()
        cmd = parts[0].lower()
        if cmd in ("quit", "exit", "q"):
            break
        elif cmd == "params":
            esp.params.clear()
            esp.request_params()
            time.sleep(0.5)
            for k, v in esp.params.items():
                print(f"  {k:16s} = {v}")
        elif cmd == "set" and len(parts) == 3:
            esp.set_param(parts[1], int(parts[2]))
            time.sleep(0.2)
            print(f"  {parts[1]} = {esp.params.get(parts[1], '?')}")
        elif cmd == "save":
            esp.save_params()
            time.sleep(0.3)
        elif cmd == "zero":
            esp.zero_yaw()
        elif cmd == "version":
            esp.write(b"$V*56\n")
            time.sleep(0.3)
            print("  ", ",".join(esp.info))
        elif cmd == "monitor":
            t0 = time.time()
            while time.time() - t0 < 5:
                if last:
                    print(f"  yaw {last['yaw_deg']:+7.2f}  gz {last['gz_dps']:+6.2f}  vbat {last['vbat']:.2f}V  "
                          f"us {last['us_mm']}mm  thr {last['thr']:+.2f} steer {last['steer']:+.2f}  flags {last['flags']}")
                time.sleep(0.25)
        else:
            print(__doc__)
    esp.stop()


if __name__ == "__main__":
    main()
