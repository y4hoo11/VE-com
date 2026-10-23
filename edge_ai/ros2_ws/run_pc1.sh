#!/bin/bash
# =====================================================================
#  PC1（ve_con_ros2 コンテナの中）で実行: ビルドして Nav2 + mission_manager + mqtt_bridge + マーカー補正を起動
#
#    docker exec -it ve_con_ros2 bash
#    bash /workspace/ros2_ws/run_pc1.sh                     # ふつう
#    bash /workspace/ros2_ws/run_pc1.sh use_rviz:=false     # 引数は navigation.launch.py にそのまま渡る
#
#  ラズパイ側は edge_ai/scripts/start_robot.sh（ラズパイで実行）
# =====================================================================
set -e
source /opt/ros/humble/setup.bash
# ROS_LOCALHOST_ONLY=1 のとき、ノード（プロセス）が多いと見つけ合えなくなることがあるので、
# localhost でマルチキャストを使えるようにする（docker-compose.pc1-zenoh.yml の NET_ADMIN が必要。無ければ何もしない）
ip link set lo multicast on 2>/dev/null || true
cd /workspace/ros2_ws
colcon build --symlink-install
source install/setup.bash
exec ros2 launch agv_navigation navigation.launch.py "$@"
