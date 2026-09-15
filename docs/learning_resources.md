# 学習資料リンク集（AI担当向け・レイヤー別）

VE-com の AI担当（ROS 2 / マーカー認識 / 通信）が理解を進めるための資料を、
**レイヤーごと**に「簡易版（まず読む・日本語）」と「公式版（詰まったら引く）」の2種類でまとめたもの。

上から順に降りていく構成。各レイヤーの冒頭に「このレイヤーで何が分かるか」を書いてある。

---

## レイヤー0：ROS とは何か（全体像をつかむ）

> **分かること**: なぜ ROS を使うのか。ロボット開発における位置づけ。

### 簡易版

- [５分でワカル!? ROSとはなにか](https://docs.google.com/presentation/d/1BZU3nFDiSrUU7wAMpqgY4kU6-65wxzvfHVRZigsHlDI/edit) — ROS Japan UG のスライド。最初の1本
- [ROSでできること、ツールなどの説明（FANUC）](https://www.fanuc.co.jp/ja/product/robot/academia/5min-basics/what-is-ros.html) — 制作概要.md にも載っている解説
- [ROS 2の初学者向け資料まとめ（Qiita）](https://qiita.com/koichi_baseball/items/b15783ced5df8d5e56a6) — **日本語資料の総index。2024年10月更新。迷ったらここから辿る**

### 公式版

- [ROS 2 Documentation: Humble](https://docs.ros.org/en/humble/index.html) — **このプロジェクトのバージョンは Humble。他バージョンの記事はAPIが違うことがあるので注意**

---

## レイヤー1：ノードとトピック（ROS 2 の基本文法）

> **分かること**: 手順4の turtlesim で見た構造。ノードが互いを知らずにデータをやり取りする仕組み。
> **通信の4形式**: トピック（一方向・非同期）／サービス（双方向・同期）／アクション（時間のかかる依頼）／パラメータ。

### 簡易版

- [ROS 2 Humble 公式チュートリアル 01: 環境構築から turtlesim まで](https://yusukekato.jp/html/2023/0910.html/) — **手順4でやったことの解説そのもの**
- [ROS 2 Humble 公式チュートリアル 02: ノード関係のコマンド](https://yusukekato.jp/html/2023/0913.html)
- [ROS 2 Jazzy公式チュートリアル02: ノードとトピックについて](https://yusukekato.jp/html/2024/0927.html/) — Jazzy版だが概念は同じ

### 公式版

- [Understanding nodes](https://docs.ros.org/en/humble/Tutorials/Beginner-CLI-Tools/Understanding-ROS2-Nodes/Understanding-ROS2-Nodes.html)
- [Understanding topics](https://docs.ros.org/en/humble/Tutorials/Beginner-CLI-Tools/Understanding-ROS2-Topics/Understanding-ROS2-Topics.html)
- [Understanding actions](https://docs.ros.org/en/humble/Tutorials/Beginner-CLI-Tools/Understanding-ROS2-Actions/Understanding-ROS2-Actions.html) — **`/navigate_to_pose` がこれ。あなたの接続点なので重要**

---

## レイヤー2：座標変換 tf2（`2D Pose Estimate` の正体）

> **分かること**: なぜ `map` `odom` `base_link` の3つがあるのか。
> 手順6で出た `Invalid frame ID "odom"` が何を意味していたか。

### 簡易版

- [ROSの座標変換TFについて](https://memo.soarcloud.com/ros%E3%81%AE%E5%BA%A7%E6%A8%99%E5%A4%89%E6%8F%9Btf%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6/) — TF の考え方（ツリー構造、broadcaster と listener）
- [ナビゲーションにおける自己位置推定](https://www.yokoido.com/post/self-position_estimation) — AMCL が何をしているか
- [odomフレームなしでNav2を動かす（Qiita）](https://qiita.com/porizou1/items/62f7b2a306769b0e3ad9) — 逆から理解する用。odom の役割がはっきりする

### 公式版

- [tf2 Tutorials](https://docs.ros.org/en/humble/Tutorials/Intermediate/Tf2/Tf2-Main.html)
- [Nav2: Setting Up Transformations](https://docs.nav2.org/setup_guides/transformation/setup_transforms.html) — **Nav2 が要求する座標変換の要件。実機を繋ぐときに必読**
- [REP 105: Coordinate Frames for Mobile Platforms](https://www.ros.org/reps/rep-0105.html) — `map → odom → base_link` という並びを定めた規格そのもの

---

## レイヤー3：Nav2（担当機能①「目的地までのルートどり」）

> **分かること**: `Nav2 Goal` を1回クリックしただけで内部で何が起きているか。
> 11個のノード（planner / controller / costmap / behavior / bt_navigator …）の役割分担。

### 簡易版

- [【ライブラリ#1】Nav2（Qiita）](https://qiita.com/erina_mori/items/65c137670c6ed3ab8e41) — Nav2 の概要とパッケージ構成。**まずこれ**
- [ROS 2においてNavigation2を用いた自動走行を行う方法（Qiita）](https://qiita.com/kccs_mitsuhiro-teraoka/items/7861b938df96b2b599a3) — 手順6でやった RViz 操作の解説
- [【ROS2】Navigation2の歩き方（Qiita）](https://qiita.com/koichi_baseball/items/61aab066e3eada3160ad) — costmap の plugin 設定まで踏み込む。**調整が必要になったら**
- [Navigation2を使ってロボットを動的な目的地に向かわせる（Qiita）](https://qiita.com/sfc_nakanishi_lab/items/028edb3a7d5ed0300e33) — **`marker_decider` でやりたいことに一番近い記事**
- [ROS入門 (50) - Nav2のデモの実行（note）](https://note.com/npaka/n/nc94ecd675b96)

### 公式版

- [Nav2 Documentation](https://docs.nav2.org/) — トップ
- [Navigate To Pose（Behavior Tree）](https://docs.nav2.org/behavior_trees/trees/nav_to_pose_recovery.html) — 目標を受けてから走るまでの流れ
- [Detailed Behavior Tree Walkthrough](https://docs.nav2.org/behavior_trees/overview/detailed_behavior_tree_walkthrough.html) — **「詰まったら経路を引き直し、それでも駄目なら回転・後退・待機」という復帰の論理。デモで転ばないために効く**

---

## レイヤー4：ノードを書く（rclpy）

> **分かること**: `auto_drive.py` の構造。あなたが `marker_decider.py` を書くときの型。

### 簡易版

- [How To Write a ROS2 Publisher and Subscriber (Python)](https://automaticaddison.com/how-to-write-a-ros2-publisher-and-subscriber-python-foxy/) — 図が多く分かりやすい（Foxy版だが Humble でもほぼ同じ）
- 手元の `edge_ai/ros2_ws/src/agv_main/agv_main/auto_drive.py` — **50行。実際に動く教材として一番良い**

### 公式版

- [Writing a simple publisher and subscriber (Python)](https://docs.ros.org/en/humble/Tutorials/Beginner-Client-Libraries/Writing-A-Simple-Py-Publisher-And-Subscriber.html) — **`auto_drive.py` はこれとほぼ同じ形**
- [Writing an action client (Python)](https://docs.ros.org/en/humble/Tutorials/Intermediate/Writing-an-Action-Server-Client/Py.html) — Nav2 に目標を送る仕組みの下地
- [Nav2 Simple Commander API](https://docs.nav2.org/commander_api/index.html) — **上を数行に包んでくれるもの。実際に使うのはこちら**
- [ros2/examples（GitHub）](https://github.com/ros2/examples) — 公式のサンプル実装集

---

## レイヤー5：マーカー認識（ArUco）

> **分かること**: カメラでマーカーを読み、ID・距離・角度を得る仕組み。
> **ライセンス**: OpenCV は Apache-2.0、`aruco_opencv` は MIT。どちらも制約の緩いもの。

### 簡易版

- [ArUco Marker Detection: Pose Estimation with OpenCV Python](https://zbotic.in/aruco-marker-detection-pose-estimation-with-opencv-python/)
- [How to Perform Pose Estimation Using an ArUco Marker](https://automaticaddison.com/how-to-perform-pose-estimation-using-an-aruco-marker/) — 手順が丁寧
- [How to Set Up ArUco Marker Tracking on a ROS Robot（Fictionlab）](https://docs.fictionlab.pl/integrations/software/aruco-tracking) — **導入した `aruco_opencv` の作者による解説**

### 公式版

- [OpenCV: Detection of ArUco Markers](https://docs.opencv.org/4.x/d5/dae/tutorial_aruco_detection.html) — 検出アルゴリズムの本体
- [aruco_opencv - ROS Package Overview](https://index.ros.org/p/aruco_opencv/) — パッケージ仕様とトピック定義
- [fictionlab/ros_aruco_opencv（GitHub）](https://github.com/fictionlab/ros_aruco_opencv)

> ⚠️ **API のバージョン差に注意**
> コンテナ内の `python3-opencv` は **4.5.4（旧API）**、Windows の pip は **4.7以降（新API）**。
> ネット記事の多くは新APIなので、コンテナ内にそのまま貼ると `AttributeError` になる。
>
> - 旧(4.5.4): `cv2.aruco.Dictionary_get(...)` / `DetectorParameters_create()`
> - 新(4.7+): `cv2.aruco.ArucoDetector(...)`

---

## レイヤー6：通信（MQTT）— 担当の本丸

> **分かること**: ROS 2 側の判断結果を配車サーバへ渡す仕組み。
> ROS 2 のトピックと発想が似ている（publish / subscribe）ので、対比で理解すると早い。

### 簡易版

- [【初心者向け】MQTTの基本を解説](https://start-electronics.com/electronics/soft/mqtt/)
- [IoT初心者向け！「MQTT」について簡単にまとめてみる（ラクス）](https://tech-blog.rakus.co.jp/entry/20180912/mqtt/iot/beginner)
- [IoT時代を支えるプロトコル「MQTT」（CodeZine）](https://codezine.jp/article/detail/8019) — もう少し踏み込んだ解説

### 公式版

- [Eclipse Paho Python Client](https://eclipse.dev/paho/index.php?page=clients/python/index.php) — 導入済みの `python3-paho-mqtt` の公式
- [MQTT Version 3.1.1 仕様（OASIS）](https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/mqtt-v3.1.1.html)

> **ROS 2 のトピックとの違い**: MQTT には**ブローカー**（仲介サーバ。Mosquitto など）が必要。
> ROS 2 の DDS はブローカー無しで互いを自動発見するが、MQTT は必ずブローカーを経由する。
> Wi-Fi が瞬断しても復帰しやすいため、ロボット ↔ サーバ間はこちらを使う。

---

## 書籍（腰を据えて学ぶ場合）

- **改訂新版 ROS2ではじめよう 次世代ロボットプログラミング**（youtalk 著、2024年9月）— Jazzy版
- **ROS2ではじめよう 次世代ロボットプログラミング**（youtalk 著）— Foxy版
- **ROS2とPythonで作って学ぶAIロボット入門**（demura.net ほか）— Foxy版

> ⚠️ **バージョンの注意**: このプロジェクトは **Humble** を使っている。
> Foxy / Jazzy / Rolling の記事はコマンドやAPIが違うことがある。
> 公式ドキュメントを見るときは、URL に `/humble/` が入っているか必ず確認すること。

---

## TurtleBot3（今使っているロボット）

- [TurtleBot3 e-Manual（ROBOTIS）](https://emanual.robotis.com/docs/en/platform/turtlebot3/overview/) — 公式。**実機を借りたらここを見る**
- [TurtleBot3 Simulation](https://emanual.robotis.com/docs/en/platform/turtlebot3/simulation/) — 今動かしている環境の解説

---

## 読む順番の提案

1. レイヤー0の「５分でワカル!? ROSとはなにか」
2. レイヤー1の公式チュートリアル01・02（**手順4でやったことの答え合わせ**）
3. レイヤー2の tf2（**手順6で詰まった理由が分かる**）
4. レイヤー3の「【ライブラリ#1】Nav2」
5. レイヤー4で `auto_drive.py` を読む
6. レイヤー5・6は、それぞれ PR #2 / PR #4 に着手する直前で十分

**全部を先に読む必要はない。** 手を動かして詰まったときに該当レイヤーを引くのが早い。
