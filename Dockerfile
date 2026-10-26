FROM osrf/ros:humble-desktop

# インストール中に対話プロンプトが出て止まるのを防ぐ
ENV DEBIAN_FRONTEND=noninteractive

# 必要なパブリックパッケージとツールのインストール
RUN apt-get update && apt-get install -y \
    python3-pip \
    ros-humble-nav2-bringup \
    ros-humble-navigation2 \
    ros-humble-slam-toolbox \
    ros-humble-rmw-cyclonedds-cpp \
    ros-humble-turtlebot3* \
    python3-colcon-common-extensions \
    git \
    net-tools \
    iputils-ping \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------
# 追加パッケージ
#
# ※ 新しいパッケージを足すときは、必ずこのブロックより「下」に
#    新しい RUN 行として追記してください。
#    上のブロックを1文字でも編集すると Docker のキャッシュが無効になり、
#    ros-humble-desktop から全部インストールし直しになります（20分コース）。
#
# 内訳:
#   aruco-opencv, aruco-opencv-msgs, python3-opencv
#       マーカー認識（ArUco）。ライセンスは MIT
#   cv-bridge, image-transport, image-publisher, rqt-image-view
#       画像の受け渡しと目視確認。image-publisher は写真/動画を
#       カメラ映像の代わりに流せるので、USBカメラ無しで開発できる
#   nav2-simple-commander
#       Python から Nav2 に「B地点へ行け」と命令するための高水準API
#   teleop-twist-keyboard
#       キーボードでの手動操作（動作確認用）
#   python3-paho-mqtt
#       MQTT 通信（配車サーバとの連携用）
#   x11-apps, mesa-utils
#       画面表示が通っているかの確認ツール（xeyes / glxgears）
#   tmux, nano
#       コンテナ内での作業用
# ---------------------------------------------------------------
RUN apt-get update && apt-get install -y \
    ros-humble-aruco-opencv \
    ros-humble-aruco-opencv-msgs \
    python3-opencv \
    ros-humble-cv-bridge \
    ros-humble-image-transport \
    ros-humble-image-publisher \
    ros-humble-rqt-image-view \
    ros-humble-nav2-simple-commander \
    ros-humble-teleop-twist-keyboard \
    python3-paho-mqtt \
    x11-apps \
    mesa-utils \
    tmux \
    nano \
    && rm -rf /var/lib/apt/lists/*

# ワークスペースディレクトリの設定
WORKDIR /workspace/ros2_ws

# 起動時の環境変数読み込み設定
RUN echo "source /opt/ros/humble/setup.bash" >> ~/.bashrc

# ビルド前は install/setup.bash が存在しないため、存在するときだけ読み込む。
# （無条件に source すると、コンテナに入るたびに
#   "No such file or directory" が出て「壊れている」と誤解しやすい）
RUN echo '[ -f /workspace/ros2_ws/install/setup.bash ] && source /workspace/ros2_ws/install/setup.bash' >> ~/.bashrc

CMD ["bash"]
