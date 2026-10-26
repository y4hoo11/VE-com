#!/bin/bash
# =====================================================================
#  ラズパイ（車両）で実行する: ROS 2 のコンテナと Zenoh ブリッジを起動する
#
#    cd ~/VE-con
#    bash edge_ai/scripts/start_robot.sh          # 起動（2回目以降も同じ）
#    bash edge_ai/scripts/start_robot.sh logs     # ログを見る（Ctrl+C で抜ける。車は止まらない）
#    bash edge_ai/scripts/start_robot.sh stop     # 止める
#
#  初めてのとき: edge_ai/README.md の「ラズパイの準備」を先にやる
# =====================================================================
set -e
cd "$(dirname "$0")/.."            # edge_ai/
COMPOSE="docker compose -f docker/docker-compose.robot.yml"

case "${1:-start}" in
  stop)
    $COMPOSE down
    exit 0 ;;
  logs)
    exec $COMPOSE logs -f --tail 100 ;;
esac

if [ ! -f docker/.env ]; then
  echo "edge_ai/docker/.env がありません。次のコマンドで作って PC1_IP を書いてください:"
  echo "  cp edge_ai/docker/robot.env.example edge_ai/docker/.env && nano edge_ai/docker/.env"
  exit 1
fi

# Pi Camera の配信（ホスト側）が動いていなければ知らせる
if ! curl -s -m 2 -o /dev/null http://127.0.0.1:8090/stream.mjpg 2>/dev/null; then
  echo "※ Pi Camera の配信 (http://127.0.0.1:8090) が見つかりません。カメラを使うなら:"
  echo "    sudo systemctl start pi-camera-relay   （設定方法は edge_ai/README.md）"
fi

$COMPOSE up -d --build
echo
echo "起動しました。ログ: bash edge_ai/scripts/start_robot.sh logs"
