#!/bin/bash
# =====================================================================
#  シミュレーター（ve_con_ros2 コンテナの中）: 実機なしで TT-02 + Nav2 + タスク実行を試す
#
#    docker exec -it ve_con_ros2 bash
#    bash /workspace/ros2_ws/run_sim.sh
#    bash /workspace/ros2_ws/run_sim.sh obstacles:="-2.0,-3.0,0.25"   # 地図に無い障害物を置く
#
#  別のターミナルから Web と同じ形のタスクを送れる:
#    source /workspace/ros2_ws/install/setup.bash
#    ros2 run agv_navigation send_task task Dock-A Station-1
#    ros2 run agv_navigation send_task watch
# =====================================================================
set -e
source /opt/ros/humble/setup.bash
# ROS_LOCALHOST_ONLY=1 のとき、ノード（プロセス）が多いと見つけ合えなくなることがあるので、
# localhost でマルチキャストを使えるようにする（docker-compose.pc1-zenoh.yml の NET_ADMIN が必要。無ければ何もしない）
ip link set lo multicast on 2>/dev/null || true
cd /workspace/ros2_ws
colcon build --symlink-install
source install/setup.bash
exec ros2 launch agv_navigation sim.launch.py "$@"
