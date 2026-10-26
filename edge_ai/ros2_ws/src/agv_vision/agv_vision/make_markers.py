"""印刷用の ArUco マーカー画像を作る。

    ros2 run agv_vision make_markers --ids 0 1 2 3 --size-mm 150
    → markers_out/marker_0.png … と、印刷用の markers_out/markers_print.pdf（1ページ1枚・実寸）ができる

印刷のコツ:
  - 「実際のサイズ」「拡大縮小なし」で印刷し、黒い四角の一辺を定規で測って
    agv_vision/config/vision.yaml の marker_size [m] に書く（ここがずれると距離がずれる）
  - 大きいほど遠くから正確に読める。2m 先から読むなら 15cm 以上がおすすめ
  - 白い余白（フチ）を切り落とさないこと。光沢紙より普通紙（反射しにくい）
"""
from __future__ import annotations

import argparse
from pathlib import Path

import cv2

from agv_vision.aruco_core import marker_image

DPI = 300


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", type=int, nargs="+", default=[0, 1, 2, 3])
    ap.add_argument("--size-mm", type=float, default=150.0, help="黒い四角の一辺 [mm]")
    ap.add_argument("--dict", default="DICT_4X4_50")
    ap.add_argument("--out", default="markers_out")
    a = ap.parse_args()

    out = Path(a.out)
    out.mkdir(exist_ok=True)
    d = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, a.dict))
    px = int(round(a.size_mm / 25.4 * DPI))
    margin = px // 6   # 白いフチ（マーカーの1マス分）。150mm なら全体 200mm で A4 に収まる
    tiles = []
    for mid in a.ids:
        img = marker_image(d, mid, px)
        img = cv2.copyMakeBorder(img, margin, margin + 40, margin, margin, cv2.BORDER_CONSTANT, value=255)
        cv2.putText(img, f"ID {mid}  ({a.size_mm:.0f}mm, {a.dict})", (margin, img.shape[0] - 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.9, 0, 2)
        cv2.imwrite(str(out / f"marker_{mid}.png"), img)
        tiles.append(img)

    # 印刷用 PDF（1ページ1枚、実寸）。Pillow があれば作る
    try:
        from PIL import Image

        pages = [Image.fromarray(t).convert("L") for t in tiles]
        pdf = out / "markers_print.pdf"
        pages[0].save(pdf, save_all=True, append_images=pages[1:], resolution=DPI)
        for mid, pg in zip(a.ids, pages):
            pg.save(out / f"marker_{mid}.png", dpi=(DPI, DPI))   # 印刷ソフトが実寸で扱えるよう DPI 情報を付ける
        print(f"印刷用 PDF: {pdf.resolve()}（「実際のサイズ」で印刷）")
    except ImportError:
        print("※ Pillow が無いので PDF は作りませんでした（pip install pillow）。PNG を 300dpi 指定で印刷してください")
    print(f"{len(tiles)} 枚作成 → {out.resolve()}  （{DPI}dpi で印刷すると黒い四角が {a.size_mm:.0f}mm）")
    print(f"vision.yaml の marker_size を {a.size_mm / 1000:.3f} にしてください")


if __name__ == "__main__":
    main()
