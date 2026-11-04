#!/usr/bin/env bash
# mock-ui をワンコマンドで起動する（Mac / Linux / WSL 用）
#   使い方: ./start.sh   （初回だけ npm install が走ります）
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[x] Node.js が見つかりません。https://nodejs.org/ から LTS 版（22 以上推奨）を入れてください。"
  exit 1
fi

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "[x] Node.js $(node -v) は古すぎます。22 以上を入れてください。"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[i] 初回なので依存パッケージを入れます（1〜2 分かかります）..."
  npm install --no-audit --no-fund
fi

echo "[i] 起動します。ブラウザが開かない場合は http://localhost:5180 を開いてください。（終了は Ctrl+C）"
npm run dev
