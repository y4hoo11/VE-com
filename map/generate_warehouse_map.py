"""
倉庫レイアウトのデモ地図（SLAM で作ったような占有格子地図）を作るスクリプト。

- 解像度・原点は demo_map と同じ（0.05 m/px, origin [-5, -5, 0]）。大きさは横長の 16m x 10m
  （demo_map の範囲 x -5〜5 をそのまま含み、右に 6m 広げた）
  → edge_ai の waypoints.yaml の地点がそのまま使える
- 「本当の配置（壁・棚・パレット）」を作ったあと、LiDAR を積んだ車が倉庫内を一周したと仮定して
  レイキャスト（光線を飛ばす計算）で地図を作る。そのため、SLAM の地図と同じく
    - 見えた面だけが壁（黒）になる
    - 棚やパレットの中、外壁の外は「未探索」（灰）のまま
    - 端に少しノイズが乗る
  という見た目になる
- 出力: warehouse_map.pgm（P5, trinary: 0=障害物 / 254=走行可 / 205=未探索） + warehouse_map.yaml

使い方:  python generate_warehouse_map.py [出力フォルダ]
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np

RES = 0.05            # m/px
ORIGIN = (-5.0, -5.0)  # 地図画像の左下が世界のどこか
W, H = 320, 200       # px（横 16m x 縦 10m）
LIDAR_RANGE = 8.0     # m（RPLIDAR A1 は最大 12m。倉庫内で実用的な距離）
RAYS = 720            # 0.5 度刻み
SEED = 7

FREE, OCC, UNKNOWN = 254, 0, 205

rng = np.random.default_rng(SEED)

# ---------------------------------------------------------------------------
# 1. 本当の配置（ground truth）。True = 物がある
# ---------------------------------------------------------------------------
gt = np.zeros((H, W), dtype=bool)  # [row, col]、row 0 = 画像の上 = y が大きい側


def to_px(x: float, y: float) -> tuple[int, int]:
    col = int(math.floor((x - ORIGIN[0]) / RES))
    row = H - 1 - int(math.floor((y - ORIGIN[1]) / RES))
    return row, col


def box(x0: float, y0: float, x1: float, y1: float) -> None:
    """世界座標の長方形を埋める"""
    r0, c0 = to_px(min(x0, x1), max(y0, y1))
    r1, c1 = to_px(max(x0, x1), min(y0, y1))
    gt[max(r0, 0):min(r1, H - 1) + 1, max(c0, 0):min(c1, W - 1) + 1] = True


def wall_h(x0: float, x1: float, y: float, t: float = 0.12) -> None:
    box(x0, y - t / 2, x1, y + t / 2)


def wall_v(x: float, y0: float, y1: float, t: float = 0.12) -> None:
    box(x - t / 2, y0, x + t / 2, y1)


# 外壁（下の壁に入荷口B のシャッター、左の壁に入荷口A の開口部の名残）
wall_h(-4.8, 10.8, 4.75, 0.15)                # 上
wall_v(10.75, -4.8, 4.8, 0.15)                # 右
wall_v(-4.75, -4.8, 4.8, 0.15)                # 左
wall_h(-4.8, -0.75, -4.75, 0.15)              # 下（入荷口B の左）
wall_h(0.75, 7.0, -4.75, 0.15)                # 下（入荷口B と出荷口C の間）
wall_h(8.4, 10.8, -4.75, 0.15)                # 下（出荷口C の右）
wall_h(7.0, 8.4, -4.92, 0.08)                 # 出荷口C のシャッター
wall_v(7.0, -4.95, -4.7, 0.1)
wall_v(8.4, -4.95, -4.7, 0.1)
wall_h(-0.75, 0.75, -4.92, 0.08)              # 入荷口B のシャッター（少し奥まっている）
wall_v(-0.75, -4.95, -4.7, 0.1)
wall_v(0.75, -4.95, -4.7, 0.1)

# 充電ステーション（Home の横、左の壁ぎわ）
box(-4.68, -4.35, -4.45, -3.65)

# 入荷口A の荷待ちパレット（左の壁ぎわ）
box(-4.6, -0.15, -4.0, 0.45)
box(-4.6, -1.95, -4.0, -1.35)

# 棚 A 列（2列。A13 は 2列の間の通路）
for y0, y1 in [(-1.95, -1.55), (-3.45, -3.05)]:
    x = -2.0
    while x < 1.55:
        box(x, y0, min(x + 0.85, 1.6), y1)  # 棚 1 区画 0.85m、区画の間に 0.05m のすき間
        x += 0.9

# 右側の部屋（Station-1）。下の壁に幅 1.1m のドア
wall_v(1.0, -1.0, 3.0, 0.08)
wall_v(3.6, -1.0, 3.0, 0.08)
wall_h(1.0, 3.6, 3.0, 0.08)
wall_h(1.0, 1.8, -1.0, 0.08)
wall_h(2.9, 3.6, -1.0, 0.08)
box(1.3, 2.5, 3.3, 2.88)        # 作業台（奥の壁ぎわ）
box(3.15, 0.2, 3.5, 0.9)        # 棚（右の壁ぎわ）

# 左上のパレット置き場（2x2）
for x0, y0 in [(-4.4, 3.4), (-3.0, 3.4), (-4.4, 1.8), (-3.0, 1.8)]:
    box(x0, y0, x0 + 1.0, y0 + 1.0)

# 柱
box(-0.6, 1.5, -0.3, 1.8)
box(-2.2, 0.2, -1.9, 0.5)

# Station-2 の作業机（上の壁ぎわ）
box(-0.7, 4.2, 0.7, 4.62)

# 右の通路の荷物、Station-3 の梱包台
box(4.45, 1.0, 4.68, 1.7)
box(4.4, -2.8, 4.68, -2.15)

# ---- ここから右側の増築エリア（x 5〜10.7） ----
# 棚 B 列（3列、横向き）
for y0, y1 in [(2.9, 3.3), (1.0, 1.4), (-0.9, -0.5)]:
    x = 5.8
    while x < 9.35:
        box(x, y0, min(x + 0.85, 9.4), y1)
        x += 0.9

# 出荷口C の前の荷待ちパレット（シャッターの前は通路として空けておく）
box(6.0, -3.6, 6.8, -2.9)
box(8.8, -3.6, 9.6, -2.9)

# 柱（もとの外壁の位置と、増築エリア）
box(4.6, 2.9, 4.9, 3.2)
box(4.6, -0.5, 4.9, -0.2)
box(5.25, -3.4, 5.55, -3.1)

# 2台目の充電ステーション（右下の角）
box(10.45, -4.3, 10.68, -3.7)

# ---------------------------------------------------------------------------
# 2. 地図を作るために車が走った経路（倉庫内をひととおり回る）
# ---------------------------------------------------------------------------
route = [
    (-4.0, -4.0), (0.0, -4.1), (4.1, -4.1), (7.7, -4.1), (10.1, -4.1), (10.1, 4.0),
    (10.1, 2.15), (5.2, 2.15), (5.2, 0.25), (10.1, 0.25), (10.1, -1.8), (5.2, -1.8),
    (4.15, -1.5), (4.15, 4.0), (9.9, 4.0), (4.15, 4.0),
    (0.0, 3.6), (0.0, 0.0), (2.35, -0.4), (2.25, 1.0), (2.25, 2.0),
    (2.35, -0.4), (0.0, -0.6), (-3.0, -0.8), (-3.2, 1.3), (-1.5, 1.3),
    (-1.5, 3.1), (-4.0, 3.1), (-1.5, 3.1), (-1.5, 1.3), (-2.6, -2.5),
    (1.8, -2.5), (1.8, -4.0), (-4.0, -4.0),
]


def sample_route(points, step=0.25):
    out = []
    for (xa, ya), (xb, yb) in zip(points, points[1:]):
        n = max(1, int(math.hypot(xb - xa, yb - ya) / step))
        for i in range(n):
            t = i / n
            out.append((xa + (xb - xa) * t, ya + (yb - ya) * t))
    out.append(points[-1])
    return out


poses = sample_route(route)

# ---------------------------------------------------------------------------
# 3. レイキャストで「見えた」場所を数える
# ---------------------------------------------------------------------------
free_cnt = np.zeros((H, W), dtype=np.int32)
hit_cnt = np.zeros((H, W), dtype=np.int32)
step = RES * 0.5
angles = np.linspace(0, 2 * math.pi, RAYS, endpoint=False)

for (px, py) in poses:
    px += rng.normal(0, 0.01)
    py += rng.normal(0, 0.01)
    for a in angles + rng.normal(0, 0.002, RAYS):
        ca, sa = math.cos(a), math.sin(a)
        d = 0.0
        last = None
        while d < LIDAR_RANGE:
            x, y = px + ca * d, py + sa * d
            r, c = to_px(x, y)
            if not (0 <= r < H and 0 <= c < W):
                break
            if gt[r, c]:
                # 距離のノイズ（±1px 程度）を乗せて、当たった場所を記録
                dn = d + rng.normal(0, 0.015)
                hr, hc = to_px(px + ca * dn, py + sa * dn)
                if 0 <= hr < H and 0 <= hc < W:
                    hit_cnt[hr, hc] += 1
                break
            if (r, c) != last:
                free_cnt[r, c] += 1
                last = (r, c)
            d += step

# ---------------------------------------------------------------------------
# 4. 占有格子にまとめる（slam_toolbox の trinary 出力と同じ 3 値）
# ---------------------------------------------------------------------------
grid = np.full((H, W), UNKNOWN, dtype=np.uint8)
occupied = (hit_cnt >= 2) & (hit_cnt >= 0.25 * (hit_cnt + free_cnt))
grid[(free_cnt > 0)] = FREE
grid[occupied] = OCC

# 一時的にいた人や台車の写り込み（SLAM の地図によく残る小さな点）
# 地点（waypoints.yaml）と車の経路の近くには置かない
WAYPOINTS = [(-4.0, -4.0), (-3.0, -0.8), (0.0, -4.0), (-1.0, -2.5), (2.25, 1.0), (0.0, 3.5), (4.15, -3.5)]


def far_from(r, c, points, dist_m):
    return all(math.hypot(r - pr, c - pc) * RES >= dist_m for pr, pc in (to_px(x, y) for x, y in points))


for _ in range(10):
    while True:
        r, c = rng.integers(10, H - 10), rng.integers(10, W - 10)
        if (grid[r, c] == FREE and not gt[max(r - 6, 0):r + 7, max(c - 6, 0):c + 7].any()
                and far_from(r, c, WAYPOINTS, 0.9) and far_from(r, c, poses, 0.45)):
            break
    grid[r, c] = OCC
    if rng.random() < 0.5:
        grid[r, min(c + 1, W - 1)] = OCC

# ---------------------------------------------------------------------------
# 5. 保存
# ---------------------------------------------------------------------------
out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent
out_dir.mkdir(parents=True, exist_ok=True)
pgm = out_dir / "warehouse_map.pgm"
with open(pgm, "wb") as f:
    f.write(f"P5\n{W} {H}\n255\n".encode())
    f.write(grid.tobytes())

(out_dir / "warehouse_map.yaml").write_text(
    "image: warehouse_map.pgm\n"
    "mode: trinary\n"
    f"resolution: {RES}       # 1ピクセルあたり0.05メートル（5cm）\n"
    f"origin: [{ORIGIN[0]}, {ORIGIN[1]}, 0.0] # 原点（地図の左下端が世界のどの座標か）\n"
    "negate: 0\n"
    "occupied_thresh: 0.65\n"
    "free_thresh: 0.25\n",
    encoding="utf-8",
)
np.save(out_dir / "_gt.npy", gt)
print(f"saved {pgm}  free={int((grid == FREE).sum())} occ={int((grid == OCC).sum())} unknown={int((grid == UNKNOWN).sum())}")
