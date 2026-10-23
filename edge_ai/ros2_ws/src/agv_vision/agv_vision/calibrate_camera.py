"""カメラのキャリブレーション（レンズのゆがみ・焦点距離を測る）。

1. チェスボード（例: 内側の角が 9x6 個、1マス 25mm）を印刷して板に貼る
2. ラズパイのカメラで、いろいろな角度・位置からチェスボードを 15〜25 枚撮る
   （ros2 run agv_vision grab_frames で、カメラ映像を見ながら Enter で保存できる）
3. ros2 run agv_vision calibrate_camera --images "calib/*.jpg" --cols 9 --rows 6 --square-mm 25 \
       --out ~/ros2_ws/src/agv_main/config/camera_calib.yaml
4. ラズパイの camera_node が camera/camera_info として配信し、marker_localizer はそれを使う
   （colcon build し直して robot.launch.py を再起動すると反映）

※ 撮る画像サイズは本番と同じ（640x480）にすること
"""
from __future__ import annotations

import argparse
import glob
from pathlib import Path

import cv2
import numpy as np
import yaml


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True)
    ap.add_argument("--cols", type=int, default=9, help="内側の角の数（横）")
    ap.add_argument("--rows", type=int, default=6, help="内側の角の数（縦）")
    ap.add_argument("--square-mm", type=float, default=25.0)
    ap.add_argument("--out", default="camera_calib.yaml")
    a = ap.parse_args()

    objp = np.zeros((a.rows * a.cols, 3), np.float32)
    objp[:, :2] = np.mgrid[0:a.cols, 0:a.rows].T.reshape(-1, 2) * (a.square_mm / 1000.0)
    obj_pts, img_pts, size = [], [], None
    files = sorted(glob.glob(a.images))
    for f in files:
        img = cv2.imdecode(np.fromfile(f, np.uint8), cv2.IMREAD_GRAYSCALE)
        if img is None:
            continue
        size = img.shape[::-1]
        ok, corners = cv2.findChessboardCorners(img, (a.cols, a.rows))
        if not ok:
            print(f"  × {f}（チェスボードが見つからない）")
            continue
        corners = cv2.cornerSubPix(img, corners, (11, 11), (-1, -1),
                                   (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 1e-3))
        obj_pts.append(objp)
        img_pts.append(corners)
        print(f"  ○ {f}")
    if len(obj_pts) < 8:
        raise SystemExit(f"使える画像が {len(obj_pts)} 枚しかありません（8枚以上必要）")
    rms, K, dist, _, _ = cv2.calibrateCamera(obj_pts, img_pts, size, None, None)
    print(f"再投影誤差 RMS = {rms:.3f} px（1.0 未満なら良好）")
    data = {
        "width": int(size[0]), "height": int(size[1]),
        "camera_matrix": [[float(v) for v in row] for row in K],
        "dist_coeffs": [float(v) for v in dist.ravel()[:5]],
        "rms": float(rms),
    }
    text = "# ros2 run agv_vision calibrate_camera で作成\n" + yaml.safe_dump(data, allow_unicode=True)
    Path(a.out).write_text(text, encoding="utf-8")
    print(f"保存しました: {a.out}")


if __name__ == "__main__":
    main()
