"""Nav2 の navigate_to_pose アクションを、待たずに（ノードを止めずに）使うための小さなクライアント。

nav2_simple_commander の BasicNavigator は便利だが、中で spin するので
他のノードの中（タイマー処理）から使うと固まりやすい。ここでは ActionClient を直接使う。
"""
from __future__ import annotations

from action_msgs.msg import GoalStatus
from geometry_msgs.msg import PoseStamped
from nav2_msgs.action import NavigateToPose
from rclpy.action import ActionClient

from .mission import NAV_ACTIVE, NAV_CANCELED, NAV_FAILED, NAV_IDLE, NAV_PENDING, NAV_SUCCEEDED
from .waypoints import Pose2D


def make_pose_stamped(node, pose: Pose2D, frame: str) -> PoseStamped:
    import math
    p = PoseStamped()
    p.header.frame_id = frame
    p.header.stamp = node.get_clock().now().to_msg()
    p.pose.position.x = float(pose.x)
    p.pose.position.y = float(pose.y)
    p.pose.orientation.z = math.sin(pose.theta / 2.0)
    p.pose.orientation.w = math.cos(pose.theta / 2.0)
    return p


class Nav2Client:
    def __init__(self, node, action_name: str = "navigate_to_pose", frame: str = "map", behavior_tree: str = ""):
        self.node = node
        self.frame = frame
        self.behavior_tree = behavior_tree
        self.client = ActionClient(node, NavigateToPose, action_name)
        self.state = NAV_IDLE
        self.distance_remaining: float | None = None
        self.recoveries = 0
        self._gen = 0             # 古いゴールの結果を無視するための番号
        self._goal_handle = None
        self._pending: tuple[Pose2D, str] | None = None

    @property
    def server_ready(self) -> bool:
        return self.client.server_is_ready()

    def go(self, pose: Pose2D, name: str = "") -> None:
        self.cancel()
        self._gen += 1
        self.state = NAV_PENDING
        self.distance_remaining = None
        self.recoveries = 0
        self._pending = (pose, name)
        self.poll()

    def poll(self) -> None:
        """Nav2 がまだ起動していなければ、起動を待ってから送る（周期的に呼ぶ）。"""
        if self._pending is None or not self.client.server_is_ready():
            return
        pose, _name = self._pending
        self._pending = None
        goal = NavigateToPose.Goal()
        goal.pose = make_pose_stamped(self.node, pose, self.frame)
        goal.behavior_tree = self.behavior_tree
        gen = self._gen
        fut = self.client.send_goal_async(goal, feedback_callback=lambda fb, g=gen: self._on_feedback(g, fb))
        fut.add_done_callback(lambda f, g=gen: self._on_goal_response(g, f))

    def cancel(self) -> None:
        self._pending = None
        gh, self._goal_handle = self._goal_handle, None
        if gh is not None and self.state in (NAV_PENDING, NAV_ACTIVE):
            try:
                gh.cancel_goal_async()
            except Exception:
                pass
        if self.state in (NAV_PENDING, NAV_ACTIVE):
            self.state = NAV_CANCELED
        self._gen += 1

    # ---- コールバック ----
    def _on_goal_response(self, gen: int, fut) -> None:
        try:
            gh = fut.result()
        except Exception as e:
            if gen == self._gen:
                self.node.get_logger().warn(f"Nav2 へのゴール送信に失敗: {e!r}")
                self.state = NAV_FAILED
            return
        if gen != self._gen:   # その間に取り消された → Nav2 側でも取り消す
            if gh is not None and gh.accepted:
                gh.cancel_goal_async()
            return
        if gh is None or not gh.accepted:
            self.node.get_logger().warn("Nav2 がゴールを受け付けませんでした")
            self.state = NAV_FAILED
            return
        self._goal_handle = gh
        self.state = NAV_ACTIVE
        gh.get_result_async().add_done_callback(lambda f, g=gen: self._on_result(g, f))

    def _on_feedback(self, gen: int, fb_msg) -> None:
        if gen != self._gen:
            return
        fb = fb_msg.feedback
        self.distance_remaining = float(fb.distance_remaining)
        self.recoveries = int(fb.number_of_recoveries)

    def _on_result(self, gen: int, fut) -> None:
        if gen != self._gen:
            return
        try:
            status = fut.result().status
        except Exception:
            status = GoalStatus.STATUS_ABORTED
        self._goal_handle = None
        if status == GoalStatus.STATUS_SUCCEEDED:
            self.state = NAV_SUCCEEDED
        elif status == GoalStatus.STATUS_CANCELED:
            self.state = NAV_CANCELED
        else:
            self.state = NAV_FAILED
