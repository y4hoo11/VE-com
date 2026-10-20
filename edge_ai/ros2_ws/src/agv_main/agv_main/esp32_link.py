"""ESP32 との USB シリアル通信。

- 受信は別スレッド。テレメトリ($T)・アラート($A)・情報($I)・パラメータ($p)をコールバックで渡す
- 抜けたり ESP32 がリセットされたりしても自動で再接続する
"""
from __future__ import annotations

import glob
import logging
import threading
import time
from typing import Callable

try:
    import serial  # python3-serial（pyserial）
except ImportError:  # シミュレーターやテストだけなら無くてもよい
    serial = None

from . import protocol

log = logging.getLogger("esp32")


def find_esp32_port() -> str | None:
    # ESP32-C3 の内蔵USB は "Espressif" という名前で出てくる
    for pat in ("/dev/serial/by-id/*Espressif*", "/dev/serial/by-id/*ESP32*", "/dev/ttyACM*"):
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[0]
    return None


class Esp32Link:
    def __init__(self, port: str = "auto", baud: int = 115200,
                 on_telemetry: Callable[[dict], None] | None = None,
                 on_alert: Callable[[str, str], None] | None = None):
        self.port_cfg = port
        self.baud = int(baud)
        self.on_telemetry = on_telemetry
        self.on_alert = on_alert
        self.ser: serial.Serial | None = None
        self.port: str | None = None
        self._wlock = threading.Lock()
        self._running = False
        self._thread: threading.Thread | None = None
        self.last_rx = 0.0
        self.info: list[str] = []
        self.params: dict[str, str] = {}
        self.bad_lines = 0

    @property
    def online(self) -> bool:
        return self.ser is not None and time.time() - self.last_rx < 1.0

    def start(self) -> None:
        self._running = True
        self._thread = threading.Thread(target=self._loop, name="esp32", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        try:
            self.send_stop()
        except Exception:
            pass
        self._running = False
        if self._thread is not None:
            self._thread.join(timeout=1.0)   # 受信スレッドが終わってから閉じる
        self._close()

    def _open(self) -> bool:
        port = find_esp32_port() if self.port_cfg in (None, "", "auto") else self.port_cfg
        if not port:
            return False
        try:
            self.ser = serial.Serial(port, self.baud, timeout=0.2, write_timeout=0.2)
            self.port = port
            self.ser.reset_input_buffer()
            log.info("ESP32 に接続: %s", port)
            self.write(protocol.build("V"))
            return True
        except Exception as e:
            log.warning("ESP32 のポート %s を開けません: %s", port, e)
            self.ser = None
            return False

    def _close(self) -> None:
        if self.ser is not None:
            try:
                self.ser.close()
            except Exception:
                pass
        self.ser = None

    def _loop(self) -> None:
        buf = b""
        while self._running:
            if self.ser is None:
                if not self._open():
                    time.sleep(2.0)
                    continue
            try:
                chunk = self.ser.read(256)
            except Exception as e:
                log.warning("ESP32 読み込みエラー（再接続します）: %s", e)
                self._close()
                time.sleep(1.0)
                continue
            if not chunk:
                continue
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                self._handle(line.decode("ascii", errors="replace"))
            if len(buf) > 4096:
                buf = b""

    def _handle(self, line: str) -> None:
        f = protocol.parse(line)
        if f is None:
            if line.strip():
                self.bad_lines += 1
                if not line.startswith("$"):
                    log.debug("ESP32: %s", line.strip())  # ESP32 のデバッグ出力など
            return
        self.last_rx = time.time()
        kind = f[0]
        if kind == "T":
            t = protocol.parse_telemetry(f)
            if t and self.on_telemetry:
                self.on_telemetry(t)
        elif kind == "A":
            code = f[1] if len(f) > 1 else "?"
            text = ",".join(f[2:]) if len(f) > 2 else ""
            log.info("ESP32 アラート: %s %s", code, text)
            if self.on_alert:
                self.on_alert(code, text)
        elif kind == "I":
            self.info = f[1:]
            log.info("ESP32 情報: %s", ",".join(self.info))
        elif kind == "p" and len(f) >= 3:
            self.params[f[1]] = f[2]

    # ---- 送信 ----
    def write(self, data: bytes) -> None:
        if self.ser is None:
            return
        with self._wlock:
            try:
                self.ser.write(data)
            except Exception as e:
                log.warning("ESP32 書き込みエラー: %s", e)
                self._close()

    def send_drive(self, seq: int, steer: float, throttle: float) -> None:
        self.write(protocol.drive(seq, steer, throttle))

    def send_stop(self) -> None:
        self.write(protocol.build("S"))

    def send_estop(self, code: int = 1) -> None:
        self.write(protocol.build("E", code))

    def send_clear(self) -> None:
        self.write(protocol.build("C"))

    def set_param(self, name: str, value) -> None:
        self.write(protocol.build("P", name, value))

    def save_params(self) -> None:
        self.write(protocol.build("W"))

    def request_params(self) -> None:
        self.write(protocol.build("R"))

    def zero_yaw(self) -> None:
        self.write(protocol.build("Z"))
