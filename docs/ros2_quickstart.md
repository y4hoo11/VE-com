# ROS 2 開発環境 立ち上げ手順（Windows 11 + Docker Desktop）

このリポジトリの `edge_ai/` を開発するための環境を、自分のPCで動かす手順です。
**1ステップごとに「画面に何が見えるか」を書いてあります。見えなかったら次に進まず、そこで止めてください。**

最終的に、**画面上でロボットが A地点から B地点へ自分で走っていく**ところまで到達します。

---

## 0. 前提の確認（最初にこれだけ）

Docker Desktop の **Settings → General → "Use the WSL 2 based engine" が ON** であることを確認してください。

**ここが違うと画面が一切出ません。** 最初に必ず確認してください。

---

## 1. 起動

PowerShell でも Git Bash でも構いません。

```shell
cd C:\Users\<あなたのユーザー名>\myapps\VE-con
docker compose up -d --build
```

**初回は 15〜25分かかります。** 失敗ではないのでコーヒーでも淹れて待ってください。2回目以降は数十秒です。

**見えるもの**: 最後に `Container ve_con_ros2  Started` と出る。

---

## 2. 画面が出るか確認（最重要。ここが通らないと先はない）

```shell
docker exec -it ve_con_ros2 bash
```

以下はコンテナの中で実行します。

```bash
xeyes
```

**見えるもの**: **Windows のデスクトップに、マウスを追いかける目玉のウィンドウが出ます。**
これが出れば画面表示は成功です。`Ctrl+C` で終了。

> 出なかったら: Docker Desktop が WSL2 バックエンドか再確認 → Docker Desktop 自体を再起動 → `docker compose down` してから `docker compose up -d`。
> それでも駄目なら**一人で粘らず、チームに相談してください。** ここは環境差が出る唯一の箇所です。

続けて 3D描画の確認:

```bash
glxgears
```

**見えるもの**: 3つの歯車が回るウィンドウ（カクついて当然です）。`Ctrl+C` で終了。

---

## 3. ROS 2 が動いているか確認

```bash
ros2 topic list
```

**見えるもの**: `/parameter_events` と `/rosout` の2行。

> **用語**: 「トピック」は、プログラム同士がデータを流し合う通り道の名前です。

### ⚠️ この先ずっと出てくる、無視してよいメッセージ

ROS 2 のコマンドを打つたびに、こういう行が混ざります。

```text
selected interface "lo" is not multicast-capable: disabling multicast
```

**これはエラーではありません。** `docker-compose.yml` で `ROS_LOCALHOST_ONLY=1`（通信をコンテナ内に限定）を設定しているため、
「外部に向けた通信を使わないようにしました」と報告しているだけです。**毎回出ますが正常なので無視してください。**

---

## 4. ROS 2 の基本を体で覚える（turtlesim）

いきなり本番に行くと迷子になります。一番小さい題材で概念を掴みます。

ターミナル1（今のまま）:

```bash
ros2 run turtlesim turtlesim_node
```

**見えるもの**: 青い画面に亀が1匹いるウィンドウ。

ターミナル2（`docker exec -it ve_con_ros2 bash` で新しく入る）:

```bash
ros2 run turtlesim turtle_teleop_key
```

**見えるもの**: 矢印キーで亀が動く。

ターミナル3:

```bash
ros2 topic echo /turtle1/cmd_vel
```

この状態でターミナル2で矢印キーを押します。

**見えるもの**: `linear: x: 2.0` `angular: z: 0.0` のような数値が流れる。

> **これが `cmd_vel`（速度指令）です。** 「前に 2.0 の速さ、回転は 0」という意味。
> ロボットを動かす命令は、シミュレータでも実機でも**すべてこの形**です。

---

## 5. `agv_main` パッケージをビルドして動かす

```bash
cd /workspace/ros2_ws
colcon build --symlink-install
source install/setup.bash
ros2 pkg executables agv_main
```

**見えるもの**: `agv_main auto_drive` という1行。
これが出れば `setup.py` / `setup.cfg` が正しく設定されている証拠です。

turtlesim を起動したまま、別ターミナルで:

```bash
source /workspace/ros2_ws/install/setup.bash
ros2 run agv_main auto_drive --ros-args -r /cmd_vel:=/turtle1/cmd_vel
```

**見えるもの**: 亀が **3秒前進 → 左に曲がる → 後退 → 停止**。
ログに「前進中...」「旋回中...」「後退中...」「停止しました」が流れます。

> `-r /cmd_vel:=/turtle1/cmd_vel` は「トピック名を差し替える」オプションです。
> `auto_drive.py` は `/cmd_vel` に指令を出しますが、亀は `/turtle1/cmd_vel` を見ているので繋ぎ替えています。

**新しいターミナルを開くたびに `source /workspace/ros2_ws/install/setup.bash` が必要です。**
`Package not found` と言われたら、たいていこれの打ち忘れです。

---

## 6. 【本命】A地点 → B地点 の自律走行を見る

新しいターミナルで:

```bash
docker exec -it ve_con_ros2 bash
ros2 launch nav2_bringup tb3_simulation_launch.py headless:=False
```

**この1行だけで、3Dシミュレータ・地図・ナビゲーション・可視化ツールが全部まとめて立ち上がります。**
起動ファイルを自分で書く必要はありません。

**見えるもの**: ウィンドウが2つ。

- **Gazebo** … 3Dの部屋の中にロボットがいる
- **RViz2** … 上から見た地図と、ロボットのレーザーの点

**30秒ほど待ってから**、**RViz2 の方で**操作します（Gazebo ではありません）。

1. 上部ツールバーの **`2D Pose Estimate`** を押す
2. 地図上でロボットがいる場所をクリックし、向いている方向へドラッグして離す
   → **見えるもの**: 地図の線とレーザーの点がピタッと重なる
   → これが**自己位置推定**（「ロボットは今ここにいる」と教えた）
3. 上部の **`Nav2 Goal`** を押す
4. 地図の別の場所をクリックし、向かせたい方向へドラッグして離す

**見えるもの（ゴール）**:
**RViz に緑色の経路が描かれ、Gazebo の中のロボットが障害物を避けながら自分で走っていきます。**

**ここまで到達したら完了です。**

> **重い場合**: `headless:=False` を消して `ros2 launch nav2_bringup tb3_simulation_launch.py` だけにしてください。
> Gazebo の3D画面が出なくなる代わりに軽くなり、RViz 上ではちゃんとロボットが動くのが見えます。
> 実はこちらの方が快適です。

---

## 困ったときの対処

| 症状 | 対処 |
| --- | --- |
| `xeyes` が出ない | Docker Desktop が WSL2 バックエンドか確認 → Docker Desktop を再起動 |
| 初回ビルドが終わらない | 15〜25分かかります。失敗ではありません |
| `Package not found` | 新しいターミナルごとに `source /workspace/ros2_ws/install/setup.bash` が必要 |
| Gazebo が起動途中で固まる | 初回はモデルの読み込みで数分待つことがあります |
| メモリ不足で落ちる | `C:\Users\<ユーザー名>\.wslconfig` に `[wsl2]` と `memory=8GB` の2行を書き、PowerShell で `wsl --shutdown` |
| Nav2 が目標を受け付けない | `2D Pose Estimate` を先にやっていない。または起動直後で準備が終わっていない（30秒待つ） |
| Gazebo がカクつく | `LIBGL_ALWAYS_SOFTWARE=1` で CPU 描画しているため正常です |

---

## 検証済みの動作（この手順は実機で確認済みです）

以下はコマンドライン上で動作確認済みです。**あなたが確認する必要があるのは「ウィンドウが実際に画面に出るか」だけ**です。

- `colcon build` が通り、`ros2 pkg executables agv_main` に `auto_drive` が出る
- `ros2 run agv_main auto_drive` が `/cmd_vel` に指令を流す（前進→旋回→後退→停止）
- Nav2 一式が起動し、ロボットが Gazebo 内に生成され、`/odom` `/scan` `/map` `/amcl_pose` が publish される
- X サーバへの接続が通り、OpenGL（llvmpipe によるソフトウェア描画）が動作する
- `waffle_pi` のカメラトピックが `/camera/image_raw` と `/camera/camera_info` で出る（次段階のマーカー認識で使う）

## この環境の設定について

`docker-compose.yml` に設定の意味をコメントで書いてあります。特に重要な点:

- **`ROS_DOMAIN_ID=30`** … ROS 2 の「チャンネル番号」。**チーム全員で 30 に統一してください。** 揃っていないと通信できず、揃っていないことに気づきにくいです
- **`ROS_LOCALHOST_ONLY=1`** … 通信をコンテナ内に限定。実機ロボットと繋ぐ段階になったら外します
- **`TURTLEBOT3_MODEL=waffle_pi`** … カメラ付きのモデル。`burger` にはカメラがありません

## 触ってはいけないファイル

以下は 0バイトですが、**それが正しい姿**です。消したり中身を書いたりしないでください。

- `edge_ai/ros2_ws/src/agv_main/resource/agv_main` … ROS 2 にパッケージの所在を知らせる目印
- `edge_ai/ros2_ws/src/agv_main/agv_main/__init__.py` … Python のモジュール認識用の目印
