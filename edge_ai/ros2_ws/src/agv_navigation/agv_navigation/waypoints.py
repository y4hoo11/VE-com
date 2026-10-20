"""地点（waypoints.yaml）と姿勢の小物（ROS に依存しない）。"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

import yaml


def wrap_angle(a: float) -> float:
    return (a + math.pi) % (2.0 * math.pi) - math.pi


@dataclass
class Pose2D:
    x: float = 0.0
    y: float = 0.0
    theta: float = 0.0  # rad, 反時計回り

    def distance_to(self, x: float, y: float) -> float:
        return math.hypot(x - self.x, y - self.y)

    def to_dict(self) -> dict:
        return {"x": round(self.x, 3), "y": round(self.y, 3), "theta": round(self.theta, 4)}


@dataclass
class Waypoint:
    name: str
    x: float
    y: float
    theta: float = 0.0
    charger: bool = False
    aliases: list[str] = field(default_factory=list)

    @property
    def pose(self) -> Pose2D:
        return Pose2D(self.x, self.y, self.theta)


class WaypointBook:
    def __init__(self, path: str | Path | None):
        self.items: list[Waypoint] = []
        if path and Path(path).exists():
            data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
            for w in data.get("waypoints", []) or []:
                self.items.append(Waypoint(
                    name=str(w["name"]), x=float(w["x"]), y=float(w["y"]),
                    theta=math.radians(float(w.get("theta_deg", 0.0))),
                    charger=bool(w.get("charger", False)),
                    aliases=[str(a) for a in (w.get("aliases") or [])],
                ))

    def find(self, name) -> Waypoint | None:
        if name is None:
            return None
        key = str(name).strip().lower()
        for w in self.items:
            if w.name.lower() == key or key in (a.lower() for a in w.aliases):
                return w
        return None

    def nearest(self, x: float, y: float, max_dist: float = 0.4) -> Waypoint | None:
        best, best_d = None, max_dist
        for w in self.items:
            d = math.hypot(w.x - x, w.y - y)
            if d <= best_d:
                best, best_d = w, d
        return best


def parse_pose(value, waypoints: WaypointBook | None = None) -> Pose2D | None:
    """'Home' / [x, y, theta_deg] / {x, y, theta(rad)} / "1.0,2.0[,deg]" → Pose2D"""
    if value is None:
        return None
    if isinstance(value, Pose2D):
        return value
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        th = math.radians(float(value[2])) if len(value) >= 3 else 0.0
        return Pose2D(float(value[0]), float(value[1]), th)
    if isinstance(value, dict) and "x" in value and "y" in value:
        th = value.get("theta")
        if th is None and value.get("theta_deg") is not None:
            th = math.radians(float(value["theta_deg"]))
        return Pose2D(float(value["x"]), float(value["y"]), float(th or 0.0))
    if isinstance(value, str):
        if waypoints is not None:
            wp = waypoints.find(value)
            if wp is not None:
                return wp.pose
        parts = [p for p in value.replace(" ", "").split(",") if p]
        if len(parts) in (2, 3):
            try:
                nums = [float(p) for p in parts]
            except ValueError:
                return None
            th = math.radians(nums[2]) if len(nums) == 3 else 0.0
            return Pose2D(nums[0], nums[1], th)
    return None


def has_heading(value, waypoints: WaypointBook | None = None) -> bool:
    """向きの指定があるか（地点名、[x,y,deg]、theta 付き）。無ければ「今いる方から向かう向き」にする。"""
    if isinstance(value, str):
        if waypoints is not None and waypoints.find(value) is not None:
            return True
        return len([p for p in value.split(",") if p.strip()]) == 3
    if isinstance(value, (list, tuple)):
        return len(value) >= 3
    if isinstance(value, dict):
        return value.get("theta") is not None or value.get("theta_deg") is not None
    return False
