"""ArUco マーカーから車体の位置を求める（ROS に依存しない部分）。marker_localizer ノードが使う。

座標系のおさらい:
  - マーカー座標 (OpenCV): 原点=マーカー中心, X=右, Y=上, Z=マーカーの表から手前（カメラ側）
  - カメラ座標 (OpenCV):   X=右, Y=下, Z=前
  - 車体座標:              X=前, Y=左, Z=上
  - 世界座標:              地図の x, y と 上向き z

  solvePnP で「マーカー → カメラ」の変換 T_cm が分かる。
  マーカーの世界での位置 T_wm（markers.yaml）が分かっているので、
    T_wr = T_wm · inv(T_cm) · inv(T_rc)
  で車体の世界での位置 T_wr が求まる（T_rc はカメラの取り付け位置 = TF base_link→camera_optical_frame）。
  ここでの「世界」は Nav2 の map 座標。
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

import yaml


def wrap_angle(a: float) -> float:
    return (a + math.pi) % (2.0 * math.pi) - math.pi


@dataclass
class Pose2D:
    x: float = 0.0
    y: float = 0.0
    theta: float = 0.0


@dataclass
class MarkerDef:
    id: int
    mount: str          # "wall" or "floor"
    x: float
    y: float
    z: float
    angle: float        # wall: facing [rad] / floor: rotation [rad]


def load_markers(path) -> dict[int, MarkerDef]:
    out: dict[int, MarkerDef] = {}
    if not path or not Path(path).exists():
        return out
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    for m in data.get("markers", []) or []:
        mount = str(m.get("mount", "wall")).lower()
        if mount == "floor":
            ang = float(m.get("rotation_deg", 0.0))
            z = float(m.get("z", 0.0))
        else:
            ang = float(m.get("facing_deg", 0.0))
            z = float(m.get("z", 0.15))
        out[int(m["id"])] = MarkerDef(int(m["id"]), mount, float(m["x"]), float(m["y"]), z, math.radians(ang))
    return out


def _rt_to_T(R: np.ndarray, t) -> np.ndarray:
    T = np.eye(4)
    T[:3, :3] = R
    T[:3, 3] = np.asarray(t, dtype=np.float64).reshape(3)
    return T


def marker_world_T(m: MarkerDef) -> np.ndarray:
    """markers.yaml の定義 → 世界座標でのマーカーの姿勢（4x4）。"""
    a = m.angle
    if m.mount == "floor":
        # 床に表を上にして貼る。マーカーの上辺（Y）が rotation 方向を向く
        Y = np.array([math.cos(a), math.sin(a), 0.0])
        Z = np.array([0.0, 0.0, 1.0])
    else:
        # 壁に貼る。マーカーの表（Z）が facing 方向、上辺（Y）が天井方向
        Z = np.array([math.cos(a), math.sin(a), 0.0])
        Y = np.array([0.0, 0.0, 1.0])
    X = np.cross(Y, Z)
    R = np.column_stack([X, Y, Z])
    return _rt_to_T(R, [m.x, m.y, m.z])


def camera_mount_T(cam_cfg) -> np.ndarray:
    """カメラ座標 → 車体座標 の変換 T_rc（4x4）。"""
    # 傾き 0 のとき: カメラX(右)=車体-Y, カメラY(下)=車体-Z, カメラZ(前)=車体X
    R0 = np.array([[0.0, 0.0, 1.0],
                   [-1.0, 0.0, 0.0],
                   [0.0, -1.0, 0.0]])
    pitch = math.radians(float(cam_cfg.get("pitch_deg", 0.0)))   # 正 = 下向き
    yaw = math.radians(float(cam_cfg.get("yaw_deg", 0.0)))
    Ry = np.array([[math.cos(pitch), 0, math.sin(pitch)],
                   [0, 1, 0],
                   [-math.sin(pitch), 0, math.cos(pitch)]])
    Rz = np.array([[math.cos(yaw), -math.sin(yaw), 0],
                   [math.sin(yaw), math.cos(yaw), 0],
                   [0, 0, 1]])
    R = Rz @ Ry @ R0
    return _rt_to_T(R, [float(cam_cfg.get("x", 0.0)), float(cam_cfg.get("y", 0.0)), float(cam_cfg.get("z", 0.0))])


def _get_dictionary(name: str):
    return cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, name))


def marker_image(dictionary, marker_id: int, px: int) -> np.ndarray:
    """マーカー画像（OpenCV 4.7 以降と、ROS Humble の 4.5 の両方で動く）"""
    if hasattr(cv2.aruco, "generateImageMarker"):
        return cv2.aruco.generateImageMarker(dictionary, int(marker_id), int(px))
    return cv2.aruco.drawMarker(dictionary, int(marker_id), int(px))


@dataclass
class MarkerObservation:
    id: int
    corners: np.ndarray          # (4, 2) 画像上の角
    distance: float | None = None
    robot_pose: Pose2D | None = None   # このマーカーから計算した車体位置（定義済みマーカーのみ）
    size_px: float = 0.0               # 画像上のマーカーの大きさ（一辺, px）
    bearing: float | None = None       # カメラから見たマーカーの方向 [rad]（車体座標, 左が+）
    range_h: float | None = None       # カメラからマーカーまでの水平距離 [m]
    world_xy: tuple[float, float] | None = None   # マーカーの世界座標

    @property
    def pose_reliable(self) -> bool:
        """大きく写っていれば車体の向きまで信用できる（小さいと向きがあいまいになる）"""
        return self.robot_pose is not None and self.size_px >= self.min_px

    min_px: float = 60.0


def T_from_tf(tx, ty, tz, qx, qy, qz, qw) -> np.ndarray:
    """TF（平行移動 + クォータニオン）→ 4x4"""
    R = np.array([
        [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
        [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
        [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
    ])
    return _rt_to_T(R, [tx, ty, tz])


class ArucoLocalizer:
    def __init__(self, vision_cfg, cam_cfg, calib_path: str | None, markers: dict[int, MarkerDef]):
        self.dictionary = _get_dictionary(str(vision_cfg.get("aruco_dict", "DICT_4X4_50")))
        self.size = float(vision_cfg.get("marker_size", 0.10))
        self.max_dist = float(vision_cfg.get("max_marker_distance", 2.5))
        self.min_reliable_px = float(vision_cfg.get("min_size_px", 60.0))
        self.markers = markers
        self.set_mount(camera_mount_T(cam_cfg))
        self.T_wm = {mid: marker_world_T(m) for mid, m in markers.items()}

        self.K = np.array([[259.0, 0, 320.0], [0, 259.0, 240.0], [0, 0, 1]])
        self.dist = np.zeros(5)
        self.calib_size = (640, 480)
        if calib_path and Path(calib_path).exists():
            c = yaml.safe_load(Path(calib_path).read_text(encoding="utf-8"))
            self.set_intrinsics(c["camera_matrix"], c.get("dist_coeffs", [0, 0, 0, 0, 0]),
                                int(c.get("width", 640)), int(c.get("height", 480)))

        try:
            params = cv2.aruco.DetectorParameters()
            params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
            self._detector = cv2.aruco.ArucoDetector(self.dictionary, params)
        except (AttributeError, TypeError, cv2.error):  # OpenCV 4.6 以前（ROS Humble の Ubuntu 22.04 は 4.5）
            self._detector = None
            self._params = cv2.aruco.DetectorParameters_create()

        if not hasattr(self, "_params"):
            self._params = None
        if self._params is not None:
            self._params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX

        s = self.size / 2.0
        # OpenCV の ArUco の角の順番: 左上, 右上, 右下, 左下
        self.obj_pts = np.array([[-s, s, 0], [s, s, 0], [s, -s, 0], [-s, -s, 0]], dtype=np.float64)

    def set_mount(self, T_rc: np.ndarray) -> None:
        """カメラ（光学座標）→ 車体 の変換を入れる（ROS では TF base_link→camera_optical_frame）。"""
        self.T_rc = np.asarray(T_rc, dtype=np.float64)
        self.T_cr = np.linalg.inv(self.T_rc)

    def set_intrinsics(self, K, dist, width: int, height: int) -> None:
        self.K = np.asarray(K, dtype=np.float64).reshape(3, 3)
        d = np.asarray(dist, dtype=np.float64).ravel()
        self.dist = d if d.size else np.zeros(5)
        self.calib_size = (int(width), int(height))

    def _scaled_K(self, w: int, h: int) -> np.ndarray:
        cw, ch = self.calib_size
        if (w, h) == (cw, ch):
            return self.K
        K = self.K.copy()
        K[0, :] *= w / cw
        K[1, :] *= h / ch
        return K

    def detect(self, frame_bgr: np.ndarray) -> list[MarkerObservation]:
        gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY) if frame_bgr.ndim == 3 else frame_bgr
        if self._detector is not None:
            corners, ids, _ = self._detector.detectMarkers(gray)
        else:
            corners, ids, _ = cv2.aruco.detectMarkers(gray, self.dictionary, parameters=self._params)
        out: list[MarkerObservation] = []
        if ids is None:
            return out
        h, w = gray.shape[:2]
        K = self._scaled_K(w, h)
        for c, mid in zip(corners, ids.flatten().tolist()):
            img_pts = c.reshape(4, 2).astype(np.float64)
            obs = MarkerObservation(id=int(mid), corners=img_pts)
            obs.min_px = self.min_reliable_px
            try:
                n, rvecs, tvecs, _ = cv2.solvePnPGeneric(self.obj_pts, img_pts, K, self.dist,
                                                         flags=cv2.SOLVEPNP_IPPE_SQUARE)
            except cv2.error:
                n, rvecs, tvecs = 0, [], []
            obs.size_px = float(np.mean([np.linalg.norm(img_pts[i] - img_pts[(i + 1) % 4]) for i in range(4)]))
            if n:
                obs.distance = float(np.linalg.norm(tvecs[0]))
                if mid in self.T_wm and obs.distance <= self.max_dist:
                    # 方向と距離（小さく写っていても正確に分かる）
                    p_r = self.T_rc[:3, :3] @ np.asarray(tvecs[0]).reshape(3) + self.T_rc[:3, 3]
                    dx, dy = p_r[0] - self.T_rc[0, 3], p_r[1] - self.T_rc[1, 3]
                    obs.bearing = math.atan2(dy, dx)
                    obs.range_h = math.hypot(dx, dy)
                    m = self.markers[mid]
                    obs.world_xy = (m.x, m.y)
                    # 車体の位置（向きまで含む。大きく写っているときだけ信用する）
                    obs.robot_pose = self._planar_pose(mid, img_pts, K, rvecs, tvecs)
            out.append(obs)
        return out

    @property
    def camera_xy(self) -> tuple[float, float]:
        return float(self.T_rc[0, 3]), float(self.T_rc[1, 3])

    def _planar_pose(self, mid, img_pts, K, rvecs, tvecs) -> Pose2D | None:
        """車は床の上にいる（高さ・傾きは決まっている）ことを使って、(x, y, 向き) の3つだけを求める。
        小さく写ったマーカーは「裏返しの解」と区別しにくい（姿勢のあいまいさ）ので、
        候補を全部試して、画像上のずれ（再投影誤差）が一番小さいものを細かく合わせ込む。"""
        best, best_err = None, float("inf")
        for rvec, tvec in zip(rvecs, tvecs):
            R, _ = cv2.Rodrigues(rvec)
            cand = self.robot_pose_from(mid, R, tvec)
            cand, err = self._refine(mid, cand, img_pts, K)
            if err < best_err:
                best, best_err = cand, err
        # 4つの角が平均 4px 以上ずれるなら信用しない
        return best if best_err < 4.0 else None

    def _reproj(self, mid, pose: Pose2D, K) -> np.ndarray:
        c, s = math.cos(pose.theta), math.sin(pose.theta)
        T_wr = np.array([[c, -s, 0, pose.x], [s, c, 0, pose.y], [0, 0, 1, 0], [0, 0, 0, 1]], dtype=np.float64)
        T_cm = self.T_cr @ np.linalg.inv(T_wr) @ self.T_wm[mid]
        if T_cm[2, 3] <= 0.05:
            return None  # マーカーがカメラの後ろ
        rvec, _ = cv2.Rodrigues(T_cm[:3, :3])
        pts, _ = cv2.projectPoints(self.obj_pts, rvec, T_cm[:3, 3], K, self.dist)
        return pts.reshape(4, 2)

    def _refine(self, mid, pose: Pose2D, img_pts, K, iters: int = 10) -> tuple[Pose2D, float]:
        x = np.array([pose.x, pose.y, pose.theta], dtype=np.float64)

        def residual(v):
            pr = self._reproj(mid, Pose2D(v[0], v[1], v[2]), K)
            return None if pr is None else (pr - img_pts).ravel()

        r = residual(x)
        if r is None:
            return pose, float("inf")
        for _ in range(iters):  # ガウス・ニュートン法（数値微分）
            J = np.zeros((8, 3))
            for k, h in enumerate((1e-3, 1e-3, 1e-3)):
                dx = x.copy()
                dx[k] += h
                rk = residual(dx)
                if rk is None:
                    return Pose2D(*x), float("inf")
                J[:, k] = (rk - r) / h
            try:
                step = np.linalg.lstsq(J, -r, rcond=None)[0]
            except np.linalg.LinAlgError:
                break
            step = np.clip(step, -0.3, 0.3)
            x_new = x + step
            r_new = residual(x_new)
            if r_new is None or np.sum(r_new ** 2) > np.sum(r ** 2):
                break
            x, r = x_new, r_new
            if np.max(np.abs(step)) < 1e-4:
                break
        err = float(np.sqrt(np.mean(np.sum(r.reshape(4, 2) ** 2, axis=1))))
        return Pose2D(float(x[0]), float(x[1]), wrap_angle(float(x[2]))), err

    def robot_pose_from(self, mid: int, R_cm: np.ndarray, t_cm) -> Pose2D:
        T_cm = _rt_to_T(R_cm, t_cm)
        T_wr = self.T_wm[mid] @ np.linalg.inv(T_cm) @ self.T_cr
        x, y = float(T_wr[0, 3]), float(T_wr[1, 3])
        th = math.atan2(T_wr[1, 0], T_wr[0, 0])
        return Pose2D(x, y, wrap_angle(th))

    # テスト用: 車体位置からマーカーが画像のどこに写るか
    def project_marker(self, mid: int, robot: Pose2D, w: int = 640, h: int = 480) -> np.ndarray:
        c, s = math.cos(robot.theta), math.sin(robot.theta)
        T_wr = np.array([[c, -s, 0, robot.x], [s, c, 0, robot.y], [0, 0, 1, 0], [0, 0, 0, 1]], dtype=np.float64)
        T_cm = np.linalg.inv(self.T_rc) @ np.linalg.inv(T_wr) @ self.T_wm[mid]
        rvec, _ = cv2.Rodrigues(T_cm[:3, :3])
        pts, _ = cv2.projectPoints(self.obj_pts, rvec, T_cm[:3, 3], self._scaled_K(w, h), self.dist)
        return pts.reshape(4, 2)
