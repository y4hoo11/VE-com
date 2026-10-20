# =====================================================================
#  ラズパイ（車両）用の ROS 2 Humble 環境
#  Raspberry Pi OS (64bit, Bookworm) の上で Docker として動かす（Ubuntu を入れ直さなくてよい）
#
#  使い方は edge_ai/README.md の「ラズパイ」。ふつうは edge_ai/scripts/start_robot.sh が全部やる。
# =====================================================================
FROM ros:humble-ros-base

ENV DEBIAN_FRONTEND=noninteractive

# ※ PC1 の Dockerfile と同じく、追加するときは下に新しい RUN を足す（上を変えるとキャッシュが消える）
RUN apt-get update && apt-get install -y \
    ros-humble-rmw-cyclonedds-cpp \
    ros-humble-rplidar-ros \
    ros-humble-teleop-twist-keyboard \
    python3-serial \
    python3-numpy \
    python3-yaml \
    python3-opencv \
    python3-paho-mqtt \
    python3-colcon-common-extensions \
    iproute2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/ros2_ws
RUN echo "source /opt/ros/humble/setup.bash" >> ~/.bashrc \
 && echo '[ -f /workspace/ros2_ws/install/setup.bash ] && source /workspace/ros2_ws/install/setup.bash' >> ~/.bashrc

COPY robot_entrypoint.sh /robot_entrypoint.sh
RUN chmod +x /robot_entrypoint.sh
CMD ["/robot_entrypoint.sh"]
