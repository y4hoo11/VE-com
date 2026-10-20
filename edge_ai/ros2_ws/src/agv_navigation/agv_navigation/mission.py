"""タスク（Web から来た搬送指示）の進め方（ROS に依存しない部分）。mission_manager ノードが使う。

TASK_ASSIGN: {"type":"TASK_ASSIGN","taskId":"…","taskTitle":"…","startLocation":"Dock-A","targetLocation":"Station-1"}
  → 手順（phase）:
      TO_START  : startLocation へ移動（無ければ省略）   ← 移動は Nav2 に任せる（navigate_to_pose）
      LOADING   : 荷積み待ち（timer: 決まった秒数 / confirm: Web の CONFIRM 待ち）
      TO_TARGET : targetLocation へ移動
      UNLOADING : 荷降ろし待ち
      DONE
  進み具合は agv/{id}/task に {"taskId","status","phase","progress","message"} で知らせる（前と同じ形）。

移動中に止める条件（止めたら Nav2 のゴールを取り消し、条件が消えたら同じ地点へ出し直す）:
  緊急停止中 / 一時停止中 / 自己位置を見失った / 車両（ラズパイ）からデータが来ない
"""
from __future__ import annotations

import math
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Callable

from .waypoints import Pose2D, WaypointBook, has_heading, parse_pose

IDLE, RUNNING, CHARGING, ERROR, OFFLINE = "IDLE", "RUNNING", "CHARGING", "ERROR", "OFFLINE"

# navigator.state の値
NAV_IDLE, NAV_PENDING, NAV_ACTIVE, NAV_SUCCEEDED, NAV_FAILED, NAV_CANCELED = (
    "IDLE", "PENDING", "ACTIVE", "SUCCEEDED", "FAILED", "CANCELED")


@dataclass
class Step:
    kind: str                  # "NAV" or "WAIT"
    phase: str                 # TO_START / LOADING / TO_TARGET / UNLOADING / GOTO / RETURN_HOME
    goal: Pose2D | None = None
    goal_name: str = ""
    wait_s: float = 0.0
    message: str = ""
    auto_heading: bool = False  # 到着の向きの指定が無い（今いる方から向かう向きにする）


@dataclass
class Job:
    task_id: str | None        # Web のタスク ID（GOTO などの単発移動は None）
    title: str
    steps: list[Step]
    index: int = 0
    started_at: float = field(default_factory=time.time)
    step_started_at: float = field(default_factory=time.time)
    nav_initial_length: float = 0.0
    nav_remaining: float = 0.0
    confirmed: bool = False

    @property
    def current(self) -> Step | None:
        return self.steps[self.index] if self.index < len(self.steps) else None

    @property
    def done(self) -> bool:
        return self.index >= len(self.steps)

    def advance(self, now: float) -> None:
        self.index += 1
        self.step_started_at = now
        self.nav_initial_length = 0.0
        self.nav_remaining = 0.0
        self.confirmed = False

    def progress(self, now: float | None = None) -> int:
        if not self.steps:
            return 100
        now = time.time() if now is None else now
        total = len(self.steps)
        frac = 0.0
        cur = self.current
        if cur is not None:
            if cur.kind == "NAV" and self.nav_initial_length > 0:
                frac = max(0.0, min(1.0, 1.0 - self.nav_remaining / self.nav_initial_length))
            elif cur.kind == "WAIT" and cur.wait_s > 0:
                frac = max(0.0, min(1.0, (now - self.step_started_at) / cur.wait_s))
        return int(round(100.0 * (min(self.index, total) + frac) / total))


class TaskQueue:
    def __init__(self):
        self.queue: deque[Job] = deque()
        self.current: Job | None = None

    def push(self, job: Job) -> None:
        self.queue.append(job)

    def next(self, now: float) -> Job | None:
        if self.current is None and self.queue:
            self.current = self.queue.popleft()
            self.current.started_at = now
            self.current.step_started_at = now
        return self.current

    def finish_current(self) -> Job | None:
        job, self.current = self.current, None
        return job


class MissionLogic:
    """navigator は go(pose, name) / cancel() / state / distance_remaining を持つもの（nav_client.Nav2Client）。"""

    def __init__(self, cfg, waypoints: WaypointBook, navigator,
                 publish_task: Callable[[dict], None], publish_event: Callable[[dict], None], log=None):
        self.tcfg = cfg["tasks"]
        self.ncfg = cfg["nav"]
        self.waypoints = waypoints
        self.nav = navigator
        self.publish_task = publish_task
        self.publish_event = publish_event
        self.log = log
        self.tasks = TaskQueue()

        # 外（ノード）から入れる状態
        self.online = False
        self.estop = False
        self.lost = False
        self.pi_safety = ""
        self.pose: Pose2D | None = None

        self.paused = False
        self.mode = "IDLE"
        self.note = ""
        self.blocked = False
        self._nav_active = False
        self._nav_step = None
        self._retries = 0
        self._retry_at = 0.0
        self._best_remaining = math.inf
        self._best_t = 0.0
        self._blocked_reported = False
        self._t_progress = 0.0

    def _info(self, text: str) -> None:
        if self.log:
            self.log(text)

    # ==================================================================
    #  Web からのコマンド
    # ==================================================================
    def handle_command(self, msg: dict, now: float | None = None) -> dict:
        """戻り値: ノードにしてほしいこと {"set_pose": Pose2D} / {"global_localize": True}"""
        now = time.time() if now is None else now
        action = msg.get("action")
        mtype = msg.get("type")
        if action == "EMERGENCY_STOP":
            self.estop = True
            self._stop_nav()
        elif action == "CLEAR_EMERGENCY":
            self.estop = False
        elif action == "PAUSE":
            self.paused = True
            self._stop_nav()
        elif action == "RESUME":
            self.paused = False
        elif action == "CANCEL_TASK":
            self.cancel(msg.get("taskId"), now)
        elif action == "CONFIRM":
            if self.tasks.current:
                self.tasks.current.confirmed = True
        elif action == "SET_POSE":
            pose = parse_pose(msg, self.waypoints) or parse_pose(msg.get("target"), self.waypoints)
            if pose is not None:
                self._stop_nav()   # 位置が変わるので経路を引き直す
                return {"set_pose": pose}
        elif action == "GLOBAL_LOCALIZE":
            self._stop_nav()
            return {"global_localize": True}
        elif mtype == "TASK_ASSIGN":
            self.assign_task(msg)
        elif mtype == "GOTO":
            target = msg.get("target")
            src = target if target is not None else msg
            pose = parse_pose(src, self.waypoints)
            if pose is None:
                self._info(f"GOTO の行き先が分かりません: {msg}")
                return {}
            name = str(target) if target else f"({pose.x:.2f},{pose.y:.2f})"
            self.tasks.push(Job(None, f"GOTO {name}", [Step("NAV", "GOTO", pose, name, message=f"{name} へ移動中",
                                                            auto_heading=not has_heading(src, self.waypoints))]))
        elif mtype == "RETURN_HOME":
            self._push_return_home()
        return {}

    def assign_task(self, msg: dict) -> None:
        task_id = msg.get("taskId")
        title = str(msg.get("taskTitle") or msg.get("title") or task_id or "task")
        if task_id and ((self.tasks.current and self.tasks.current.task_id == task_id)
                        or any(j.task_id == task_id for j in self.tasks.queue)):
            return  # 同じタスクが二重に届いた
        start_name = msg.get("startLocation")
        target_name = msg.get("targetLocation")
        steps: list[Step] = []
        confirm = str(self.tcfg.get("wait_mode", "timer")) == "confirm"
        if start_name:
            sp = parse_pose(start_name, self.waypoints)
            if sp is None:
                self._task_status(task_id, "FAILED", "", 0, f"出発地 '{start_name}' が waypoints に見つかりません")
                return
            steps.append(Step("NAV", "TO_START", sp, str(start_name), message=f"{start_name} へ移動中",
                              auto_heading=not has_heading(start_name, self.waypoints)))
            steps.append(Step("WAIT", "LOADING", wait_s=float(self.tcfg.get("load_wait_s", 3.0)),
                              message="荷積み中" + ("（CONFIRM 待ち）" if confirm else "")))
        if not target_name:
            self._task_status(task_id, "FAILED", "", 0, "目的地 (targetLocation) がありません")
            return
        tp = parse_pose(target_name, self.waypoints)
        if tp is None:
            self._task_status(task_id, "FAILED", "", 0, f"目的地 '{target_name}' が waypoints に見つかりません")
            return
        steps.append(Step("NAV", "TO_TARGET", tp, str(target_name), message=f"{target_name} へ移動中",
                          auto_heading=not has_heading(target_name, self.waypoints)))
        steps.append(Step("WAIT", "UNLOADING", wait_s=float(self.tcfg.get("unload_wait_s", 3.0)),
                          message="荷降ろし中" + ("（CONFIRM 待ち）" if confirm else "")))
        self.tasks.push(Job(task_id, title, steps))
        self._info(f"タスク受付: {title} ({start_name} → {target_name})")

    def cancel(self, task_id=None, now: float | None = None) -> None:
        now = time.time() if now is None else now
        cur = self.tasks.current
        if cur and (task_id is None or cur.task_id == task_id):
            self._finish_job("CANCELLED", "Webから中止されました", now)
            return
        for j in list(self.tasks.queue):
            if j.task_id == task_id:
                self.tasks.queue.remove(j)
                self._task_status(j.task_id, "CANCELLED", "", 0, "開始前に中止されました")

    def _push_return_home(self) -> None:
        home_name = str(self.tcfg.get("home_waypoint", "Home"))
        home = parse_pose(home_name, self.waypoints)
        if home is not None:
            self.tasks.push(Job(None, "RETURN_HOME", [Step("NAV", "RETURN_HOME", home, home_name, message=f"{home_name} へ戻り中")]))

    # ==================================================================
    #  周期処理（10Hz）
    # ==================================================================
    def tick(self, now: float | None = None) -> None:
        now = time.time() if now is None else now
        self.note = ""
        job = self.tasks.next(now)
        if job is None:
            self.mode = "IDLE" if self.online else "OFFLINE"
            self._stop_nav()
            self.blocked = False
            return
        step = job.current
        if step is None:
            self._finish_job("COMPLETED", "完了しました", now)
            return
        if self._t_progress == 0.0:
            self._task_status(job.task_id, "IN_PROGRESS", step.phase, job.progress(now), step.message)
            self._t_progress = now

        hold = self._hold_reason()
        if step.kind == "WAIT":
            self.mode = "WAIT"
            self._stop_nav()
            if hold and hold != "一時停止中":
                self.note = hold
            confirm = str(self.tcfg.get("wait_mode", "timer")) == "confirm"
            if (confirm and job.confirmed) or (not confirm and now - job.step_started_at >= step.wait_s):
                self._advance(job, now)
            self._periodic_progress(job, now)
            return

        # ---- NAV ----
        if self._nav_step is not step:
            self._nav_step = step
            self._nav_active = False
            self._retries = 0
            self._retry_at = 0.0
        if hold:
            self.mode = "PAUSED" if self.paused else "HOLD"
            self.note = hold
            self._stop_nav()
            self._periodic_progress(job, now)
            return
        if not self._nav_active:
            if now < self._retry_at:
                self.mode = "RETRY_WAIT"
                self.note = "経路を探し直します"
                return
            goal = self._goal_with_heading(step)
            self.nav.go(goal, step.goal_name)
            self._nav_active = True
            self._best_remaining = math.inf
            self._best_t = now
            self._blocked_reported = False
            self.blocked = False
            self._info(f"Nav2 へゴールを送信: {step.goal_name} ({goal.x:.2f}, {goal.y:.2f}, {math.degrees(goal.theta):.0f}°)")
            return

        self.mode = "NAV"
        st = self.nav.state
        if st == NAV_SUCCEEDED:
            self._info(f"{step.goal_name} に到着")
            self._nav_active = False
            self._advance(job, now)
            return
        if st in (NAV_FAILED, NAV_CANCELED):
            self._nav_active = False
            self._retries += 1
            if self._retries > int(self.ncfg.get("retries", 2)):
                self._finish_job("FAILED", f"{step.goal_name} へ移動できませんでした（Nav2 が経路を見つけられない/進めない）", now)
                return
            self._retry_at = now + float(self.ncfg.get("retry_delay_s", 3.0))
            self._info(f"移動に失敗（{st}）。{self._retry_at - now:.0f} 秒後にやり直します（{self._retries} 回目）")
            return

        if st != NAV_ACTIVE:   # PENDING: Nav2 がまだ受け付けていない（起動直後など）
            self._best_t = now
            self.note = "Nav2 の準備を待っています"
            return

        # ACTIVE: 進み具合と「進めない」の検出
        remaining = self.nav.distance_remaining
        if (remaining is None or remaining <= 0.0) and self.pose is not None and step.goal is not None:
            remaining = self.pose.distance_to(step.goal.x, step.goal.y)
        if remaining is not None and remaining > 0.0:
            job.nav_remaining = remaining
            job.nav_initial_length = max(job.nav_initial_length, remaining, 0.1)
            if remaining < self._best_remaining - 0.15:
                self._best_remaining = remaining
                self._best_t = now
                self.blocked = False
        stuck = now - self._best_t
        if stuck > float(self.ncfg.get("blocked_report_s", 15.0)):
            self.blocked = True
            self.note = f"障害物などで {stuck:.0f} 秒進めていません"
            if not self._blocked_reported:
                self._blocked_reported = True
                self.publish_event({"code": "BLOCKED", "source": "pc1",
                                    "reason": f"{step.goal_name} へ向かう途中で {stuck:.0f} 秒以上進めません"})
            if stuck > float(self.ncfg.get("fail_after_blocked_s", 60.0)):
                self._stop_nav()
                self._finish_job("FAILED", f"{step.goal_name} へ向かう途中で進めなくなりました", now)
                return
        self._periodic_progress(job, now)

    def _hold_reason(self) -> str:
        if not self.online:
            return "車両からのデータが届いていません"
        if self.estop:
            return "緊急停止中"
        if self.lost:
            return "自己位置を見失っています（マーカーが見える所へ動かすか、現在地を設定してください）"
        if self.paused:
            return "一時停止中"
        return ""

    def _goal_with_heading(self, step: Step) -> Pose2D:
        g = step.goal
        if step.auto_heading and self.pose is not None and self.pose.distance_to(g.x, g.y) > 0.05:
            return Pose2D(g.x, g.y, math.atan2(g.y - self.pose.y, g.x - self.pose.x))
        return g

    def _stop_nav(self) -> None:
        if self._nav_active:
            self.nav.cancel()
        self._nav_active = False

    def _advance(self, job: Job, now: float) -> None:
        job.advance(now)
        self._stop_nav()
        self._nav_step = None
        if job.done:
            self._finish_job("COMPLETED", "完了しました", now)
        else:
            st = job.current
            self._task_status(job.task_id, "IN_PROGRESS", st.phase, job.progress(now), st.message)

    def _finish_job(self, status: str, message: str, now: float) -> None:
        self._stop_nav()
        job = self.tasks.finish_current()
        self._nav_step = None
        self._t_progress = 0.0
        self.blocked = False
        if job is None:
            return
        phase = job.current.phase if job.current else "DONE"
        self._task_status(job.task_id, status, phase, 100 if status == "COMPLETED" else job.progress(now), message)
        self._info(f"ジョブ終了 [{status}] {job.title}: {message}")
        if status == "COMPLETED" and job.task_id and self.tcfg.get("return_home_after_task", False) and not self.tasks.queue:
            self._push_return_home()

    def _periodic_progress(self, job: Job, now: float) -> None:
        if job.task_id and now - self._t_progress >= float(self.tcfg.get("progress_publish_s", 2.0)):
            self._t_progress = now
            st = job.current
            if st is not None:
                self._task_status(job.task_id, "IN_PROGRESS", st.phase, job.progress(now), self.note or st.message)

    def _task_status(self, task_id, status: str, phase: str, progress: int, message: str) -> None:
        if not task_id:
            return
        self.publish_task({"taskId": task_id, "status": status, "phase": phase,
                           "progress": int(progress), "message": message})

    # ==================================================================
    def status(self) -> str:
        if not self.online:
            return OFFLINE
        if self.estop or self.lost or self.blocked or self.pi_safety in ("ESTOP", "BLOCKED"):
            return ERROR
        if self.tasks.current is not None:
            return RUNNING
        if self.pose is not None:
            wp = self.waypoints.nearest(self.pose.x, self.pose.y, 0.4)
            if wp is not None and wp.charger:
                return CHARGING
        return IDLE

    def summary(self) -> dict:
        job = self.tasks.current
        st = job.current if job else None
        return {
            "status": self.status(), "mode": self.mode, "note": self.note,
            "phase": st.phase if st else None,
            "taskId": job.task_id if job else None,
            "goal": st.goal_name if st and st.kind == "NAV" else None,
            "queued": len(self.tasks.queue),
        }
