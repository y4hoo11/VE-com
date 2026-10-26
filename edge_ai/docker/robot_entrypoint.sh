#!/bin/bash
# ラズパイのコンテナの中で動く: agv_main をビルドして robot.launch.py を起動する
set -e
source /opt/ros/humble/setup.bash

# DDS（ROS 2 の通信）をこの機械の中だけで使う。外（PC1）とは Zenoh ブリッジがつなぐ
ip link set lo multicast on 2>/dev/null || true

cd /workspace/ros2_ws
if [ "${AGV_SKIP_BUILD:-0}" != "1" ]; then
  echo "[robot] colcon build (agv_main)..."
  colcon build --symlink-install --packages-select agv_main
fi
source install/setup.bash

echo "[robot] 起動: AGV_ID=${AGV_ID:-AGV-01} LIDAR_DRIVER=${LIDAR_DRIVER:-rplidar_ros} CAMERA=${CAMERA:-true}"
exec ros2 launch agv_main robot.launch.py \
  agv_id:="${AGV_ID:-AGV-01}" \
  lidar_driver:="${LIDAR_DRIVER:-rplidar_ros}" \
  lidar_port:="${LIDAR_PORT:-/dev/ttyUSB0}" \
  rplidar_executable:="${RPLIDAR_EXECUTABLE:-rplidar_node}" \
  camera:="${CAMERA:-true}"
