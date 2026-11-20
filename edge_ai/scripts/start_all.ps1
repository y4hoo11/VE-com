# =====================================================================
#  start_all.ps1 … 実機実験の「動かす手前」まで、まとめて起動して接続を確かめる（Windows の PowerShell で実行）
#
#    cd C:\ve-con\VE-con
#    powershell -ExecutionPolicy Bypass -File edge_ai\scripts\start_all.ps1
#    powershell -ExecutionPolicy Bypass -File edge_ai\scripts\start_all.ps1 -Pi pi@192.168.1.50   # 名前で見つからないとき
#
#  やること（車は動かさない。速度の指令は一切送らない）:
#    1. Docker（PostgreSQL・Mosquitto・ROS 2 のコンテナ・Zenoh）を起動
#    2. Web（npm run dev）を別の窓で起動（もう動いていれば何もしない）
#    3. PC1 の ROS（run_pc1.sh = Nav2・mission_manager・mqtt_bridge）を別の窓で起動
#    4. ラズパイの車両プログラム（start_robot.sh）を ssh で起動（パスワードを聞かれたら入力）
#    5. ラズパイの情報が PC1 まで届いているか確かめて、結果を表示
# =====================================================================
param(
  [string]$Pi = "pi@agv-pi.local",
  [int]$WaitSec = 40
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8   # コンテナの出力（UTF-8）の日本語が化けないように
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $root
$compose = @("-f", "docker-compose.yml", "-f", "edge_ai/docker/docker-compose.pc1-zenoh.yml")

function Step($t) { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "  OK  $t" -ForegroundColor Green }
function Ng($t) { Write-Host "  NG  $t" -ForegroundColor Red }
function Info($t) { Write-Host "      $t" }

# ---- 0. 準備の確認 ----
Step "0. 準備の確認"
docker info *> $null
if ($LASTEXITCODE -ne 0) { Ng "Docker Desktop が起動していません。起動してから、もう一度実行してください"; exit 1 }
Ok "Docker Desktop が動いています"
$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and $_.InterfaceAlias -notlike "vEthernet*" } | Select-Object -ExpandProperty IPAddress)
Info "この PC の IP: $($ip -join ', ')  ← ラズパイの edge_ai/docker/.env の PC1_IP がこれと同じか確かめる"

# ---- 1. Docker ----
Step "1. Docker（DB・MQTT・ROS 2・Zenoh）を起動"
docker compose @compose up -d
if ($LASTEXITCODE -ne 0) { Ng "docker compose に失敗しました"; exit 1 }
Ok "コンテナを起動しました"

# ---- 2. Web ----
Step "2. Web（npm run dev）"
$webBusy = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($webBusy) {
  Ok "もう動いています（3001番が使われている）。新しくは起動しません"
} else {
  Start-Process powershell -WorkingDirectory $root -ArgumentList "-NoExit", "-Command", "npm run dev"
  Ok "別の窓で起動しました（http://localhost:5173/）"
}

# ---- 3. PC1 の ROS ----
Step "3. PC1 の ROS（run_pc1.sh）"
$rosBusy = docker exec ve_con_ros2 bash -c "pgrep -f 'navigation.launch.py' > /dev/null && echo yes"
if ($rosBusy -eq "yes") {
  Ok "もう動いています。新しくは起動しません"
} else {
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "docker exec -it ve_con_ros2 bash /workspace/ros2_ws/run_pc1.sh"
  Ok "別の窓で起動しました（RViz が開きます。止めるときはその窓で Ctrl+C）"
}

# ---- 4. ラズパイ ----
Step "4. ラズパイの車両プログラム（$Pi）"
Info "パスワードを聞かれたら、ラズパイのパスワードを入力してください（打っても画面には出ません）"
ssh $Pi "cd ~/VE-con && bash edge_ai/scripts/start_robot.sh"
if ($LASTEXITCODE -ne 0) {
  Ng "ラズパイに入れないか、起動に失敗しました"
  Info "・ssh で入れないとき: ラズパイの電源・同じ Wi-Fi か・名前（-Pi pi@IPアドレス で指定もできる）"
  Info "・REMOTE HOST IDENTIFICATION HAS CHANGED と出たとき: ssh-keygen -R agv-pi.local"
  exit 1
}
Ok "ラズパイの車両プログラムを起動しました"

# ---- 5. 確認 ----
Step "5. つながったか確認（最大 $WaitSec 秒待ちます）"
$ros = "source /opt/ros/humble/setup.bash && source /workspace/ros2_ws/install/setup.bash 2>/dev/null"
$info = $null
$deadline = (Get-Date).AddSeconds($WaitSec)
while ((Get-Date) -lt $deadline -and -not $info) {
  $json = docker exec ve_con_ros2 bash -c "$ros && python3 /workspace/ros2_ws/tools/echo_once.py /agv/robot_info 6 2>/dev/null"
  if ($json) {
    try { $info = ($json | Select-Object -Last 1) | ConvertFrom-Json } catch { $info = $null }
  }
  if (-not $info) { Start-Sleep 3 }
}

if (-not $info) {
  Ng "ラズパイの情報（/agv/robot_info）が PC1 に届きません"
  Info "・ラズパイの .env の PC1_IP が、この PC の IP（上の 0 番）と同じか"
  Info "・PC1 のファイアウォールで TCP 7447 を許可しているか"
  Info "・ラズパイのログ: ssh $Pi ""cd ~/VE-con && bash edge_ai/scripts/start_robot.sh logs"""
  exit 1
}
Ok "ラズパイ ⇔ PC1 がつながっています（Zenoh）  車両名: $($info.name)"

if ($info.esp32 -eq $true) { Ok "ESP32 とつながっています" } else { Ng "ESP32 とつながっていません（USB・ファームの書き込みを確認）" }
if ($info.fw) {
  Info "ESP32 の情報: $($info.fw)"
  if ($info.fw -match "BNO055|MPU6050") { Ok "ジャイロが見つかっています" } else { Ng "ジャイロが見つかりません（配線・ファームの I2C ピンが 8・9 か）" }
  if ($info.fw -match "PCA9685(?!_NG)") { Ok "PWM ボード（PCA9685）が見つかっています" } else { Ng "PWM ボードが見つかりません（配線・ファームの I2C ピンが 8・9 か）" }
}
if ($info.lidarHz -gt 1) { Ok "LiDAR: $($info.lidarHz) Hz" } else { Info "LiDAR: データなし（つないでいなければ正常）" }
if ($info.battery) { Info "電池: $($info.battery)%（$($info.vbat) V）" }
if ($info.piTemp) { Info "ラズパイの温度: $($info.piTemp) ℃" }

$safety = docker exec ve_con_ros2 bash -c "$ros && python3 /workspace/ros2_ws/tools/echo_once.py /agv/safety 4 2>/dev/null"
if ($safety) { Info "安全ガードの状態: $($safety | Select-Object -Last 1)" }

Write-Host ""
Write-Host "ここまでで「動かす手前」です。車はまだ動きません。" -ForegroundColor Yellow
Write-Host "次は手順書の試験 1-1（esp32_console で max_thr を下げる）→ 1-2（タイヤを浮かせて動く向きの確認）。" -ForegroundColor Yellow
