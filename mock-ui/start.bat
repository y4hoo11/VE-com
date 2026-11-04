@echo off
rem mock-ui をダブルクリックで起動する（Windows 用）
rem 初回だけ npm install が走ります。終了するときはこの黒い画面で Ctrl+C か、画面を閉じてください。
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [x] Node.js が見つかりません。https://nodejs.org/ から LTS 版（22 以上推奨）を入れてから、もう一度ダブルクリックしてください。
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo [x] Node.js のバージョンが古すぎます。22 以上を入れてください。
  node -v
  pause
  exit /b 1
)

if not exist node_modules (
  echo [i] 初回なので依存パッケージを入れます（1〜2 分かかります）...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [x] npm install に失敗しました。上のエラーを確認してください。
    pause
    exit /b 1
  )
)

echo [i] 起動します。ブラウザが開かない場合は http://localhost:5180 を開いてください。
call npm run dev
pause
