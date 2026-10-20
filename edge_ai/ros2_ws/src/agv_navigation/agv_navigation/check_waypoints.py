"""waypoints.yaml の地点が「車が行ける場所」にあり、互いに行き来できるかを地図でチェックする。
地図や地点を変えたら実行してください（Nav2 を起動しなくても動く）。

    ros2 run agv_navigation check_waypoints
    ros2 run agv_navigation check_waypoints --map maps/demo_map.yaml --waypoints config/waypoints.yaml --clearance 0.15
"""
from __future__ import annotations

import argparse
import math
import os
import sys
from collections import deque

import numpy as np

from agv_main.sim_world import SimMap

from .waypoints import WaypointBook


def _share(*parts) -> str:
    try:
        from ament_index_python.packages import get_package_share_directory
        return os.path.join(get_package_share_directory("agv_navigation"), *parts)
    except Exception:
        return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), *parts)


def inflate(occ: np.ndarray, radius_cells: int) -> np.ndarray:
    out = occ.copy()
    h, w = occ.shape
    for dy in range(-radius_cells, radius_cells + 1):
        for dx in range(-radius_cells, radius_cells + 1):
            if dx * dx + dy * dy > radius_cells * radius_cells:
                continue
            src = occ[max(0, -dy):h - max(0, dy), max(0, -dx):w - max(0, dx)]
            out[max(0, dy):h - max(0, -dy), max(0, dx):w - max(0, -dx)] |= src
    return out


def reachable(free: np.ndarray, start: tuple[int, int]) -> np.ndarray:
    seen = np.zeros_like(free, dtype=bool)
    if not free[start]:
        return seen
    q = deque([start])
    seen[start] = True
    h, w = free.shape
    while q:
        r, c = q.popleft()
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < h and 0 <= nc < w and free[nr, nc] and not seen[nr, nc]:
                seen[nr, nc] = True
                q.append((nr, nc))
    return seen


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--map", default=_share("maps", "demo_map.yaml"))
    ap.add_argument("--waypoints", default=_share("config", "waypoints.yaml"))
    ap.add_argument("--clearance", type=float, default=0.15,
                    help="壁からこれだけ離れていれば通れるとみなす [m]（車幅の半分 + 余裕）")
    a = ap.parse_args(argv)

    m = SimMap(a.map)
    wps = WaypointBook(a.waypoints)
    rad = max(1, int(math.ceil(a.clearance / m.res)))
    free = ~inflate(m.occ, rad)
    print(f"地図 {m.w}x{m.h}px ({m.w * m.res:.1f}m x {m.h * m.res:.1f}m), 地点 {len(wps.items)} 件, 通れる幅の目安 {2 * a.clearance:.2f}m")
    ng = 0
    cells = {}
    for w in wps.items:
        r, c = m.cell(w.x, w.y)
        r, c = int(r), int(c)
        inside = 0 <= r < m.h and 0 <= c < m.w
        ok = inside and bool(free[r, c])
        cells[w.name] = (r, c) if ok else None
        print(f"  {'○' if ok else '×'} {w.name:12s} ({w.x:6.2f},{w.y:6.2f})"
              + ("" if ok else "  ← 壁に近すぎる/地図の外。座標を直してください"))
        ng += 0 if ok else 1
    ok_names = [n for n, c in cells.items() if c is not None]
    if ok_names:
        reach = reachable(free, cells[ok_names[0]])
        for n in ok_names[1:]:
            if not reach[cells[n]]:
                print(f"  × 行き来できません: {ok_names[0]} ⇔ {n}（通路が狭い/ふさがっている）")
                ng += 1
    print("OK: すべての地点が有効で、行き来できます" if ng == 0 else f"NG: {ng} 件の問題があります")
    print("※ 車は切り返しが必要なので、狭い行き止まりは Nav2 が経路を見つけられないことがあります（sim.launch.py で確認）")
    return 0 if ng == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
