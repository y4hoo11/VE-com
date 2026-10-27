/**
 * @file agvProtocol.ts
 * @description Web（PC2）⇔ ROS（PC1 の mqtt_bridge）間の MQTT メッセージの型定義
 *
 * 正しい仕様は docs/agv_protocol.md（2章）。送る形を変えるときはそちらを先に直すこと。
 * ROS 側の実装: edge_ai/ros2_ws/src/agv_main/agv_main/mqtt_bridge.py（中継）
 *               edge_ai/ros2_ws/src/agv_navigation/agv_navigation/mission_manager.py（中身）
 *
 * - JSON はすべて UTF-8
 * - `{id}` は車両 ID（例 "AGV-01"）。Prisma の Vehicle.id と同じにする
 */

// =====================================================================
// 1. 座標・地図
// =====================================================================

/**
 * 地図上の位置と向き（ROS の map 座標）
 * - 単位: m。x = 右、y = 上（地図画像の上方向）
 * - theta: rad。+x 方向が 0、反時計回りが正（-π〜π）
 */
export interface Pose2D {
  x: number;
  y: number;
  theta: number;
}

/** 地図の情報（edge_ai/ros2_ws/src/agv_navigation/maps/demo_map.yaml と同じ） */
export interface MapInfo {
  mapId: string;          // "demo_map"
  image: string;          // "demo_map.pgm"
  resolution: number;     // 1 px あたりの m（demo_map: 0.05）
  origin: [number, number, number]; // 画像の左下の画素が世界のどこか [x, y, theta]（demo_map: [-5, -5, 0]）
  widthPx: number;        // demo_map: 200
  heightPx: number;       // demo_map: 200
}

export const DEMO_MAP: MapInfo = {
  mapId: 'demo_map',
  image: 'demo_map.pgm',
  resolution: 0.05,
  origin: [-5.0, -5.0, 0.0],
  widthPx: 200,
  heightPx: 200,
};

/** 地図座標 [m] → 画像のピクセル（画像は上が row 0 なので y を反転） */
export function worldToPixel(map: MapInfo, x: number, y: number): { px: number; py: number } {
  return {
    px: (x - map.origin[0]) / map.resolution,
    py: map.heightPx - (y - map.origin[1]) / map.resolution,
  };
}

/** 画像のピクセル → 地図座標 [m] */
export function pixelToWorld(map: MapInfo, px: number, py: number): { x: number; y: number } {
  return {
    x: map.origin[0] + px * map.resolution,
    y: map.origin[1] + (map.heightPx - py) * map.resolution,
  };
}

/** 地点（agv_navigation/config/waypoints.yaml の1件） */
export interface Waypoint {
  name: string;           // "Dock-A"（startLocation / targetLocation に書く名前）
  x: number;              // m
  y: number;              // m
  theta_deg: number;      // 到着時の向き [deg]（車なので目安）
  charger?: boolean;      // true の地点で待機中は status = CHARGING
  aliases?: string[];     // 別名（"1" → Station-1 など）
}

// =====================================================================
// 2. 共通の文字列（Prisma の enum と同じ文字列）
// =====================================================================

/** Prisma VehicleStatus と同じ */
export type VehicleStatus = 'IDLE' | 'RUNNING' | 'CHARGING' | 'ERROR' | 'OFFLINE';

/** agv/{id}/task で使う状態（Prisma TaskStatus の値に合わせる） */
export type TaskProgressStatus = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/** タスクの手順 */
export type TaskPhase =
  | 'TO_START'     // 出発地へ移動
  | 'LOADING'      // 荷積み待ち
  | 'TO_TARGET'    // 目的地へ移動
  | 'UNLOADING'    // 荷降ろし待ち
  | 'GOTO'         // 単発の移動
  | 'RETURN_HOME'  // ホームへ戻る
  | 'DONE'
  | '';            // 開始前に失敗したとき

/** mission_manager の細かい状態（表示用） */
export type VehicleMode = 'IDLE' | 'OFFLINE' | 'NAV' | 'WAIT' | 'PAUSED' | 'HOLD' | 'RETRY_WAIT';

// =====================================================================
// 3. Web → 車両: agv/{id}/command （QoS 1）
// =====================================================================

/** タスク割当 */
export interface TaskAssignCommand {
  type: 'TASK_ASSIGN';
  taskId: string;
  taskTitle?: string;
  startLocation?: string;  // 地点名・別名・"x,y" ・"x,y,deg"。省略すると目的地へ直行
  targetLocation: string;
}

/** 地点へ移動（地点名 or 座標） */
export type GotoCommand =
  | { type: 'GOTO'; target: string }
  | { type: 'GOTO'; x: number; y: number; theta?: number }; // theta [rad] 省略時は今の位置から向かう向き

export interface ReturnHomeCommand {
  type: 'RETURN_HOME';
}

export interface SimpleActionCommand {
  action:
    | 'EMERGENCY_STOP'   // 緊急停止（ラッチ。CLEAR_EMERGENCY まで動かない）
    | 'CLEAR_EMERGENCY'  // 緊急停止の解除
    | 'PAUSE'            // 一時停止
    | 'RESUME'           // 再開
    | 'CONFIRM'          // 荷積み/荷降ろし完了（wait_mode: confirm のとき）
    | 'GLOBAL_LOCALIZE'; // 地図全体から位置を探し直す
}

export interface CancelTaskCommand {
  action: 'CANCEL_TASK';
  taskId?: string;        // 省略すると今実行中のタスク
}

/** 現在地を手動で設定（座標 or 地点名） */
export type SetPoseCommand =
  | { action: 'SET_POSE'; x: number; y: number; theta: number } // theta [rad]
  | { action: 'SET_POSE'; target: string };

export type AgvCommand =
  | TaskAssignCommand
  | GotoCommand
  | ReturnHomeCommand
  | SimpleActionCommand
  | CancelTaskCommand
  | SetPoseCommand;

/** 全車両一斉停止: agv/broadcast/stop */
export interface BroadcastStop {
  action: 'EMERGENCY_STOP';
}

// =====================================================================
// 4. 車両 → Web: agv/{id}/telemetry （部分更新。2 種類が同じトピックに来る）
// =====================================================================

/** PC1（mission_manager）から 2Hz */
export interface NavTelemetry {
  status: VehicleStatus;
  mode: VehicleMode;
  note: string;              // 止まっている理由など（空文字あり）
  phase: TaskPhase | null;
  taskId: string | null;
  goal: string | null;       // 向かっている地点名
  queued: number;            // 待っているタスクの数
  mapId: string;             // "demo_map"
  speed: number;             // m/s（後退は負）
  locQuality: number;        // 自己位置の確からしさ 0〜1
  x?: number;                // 位置がまだ分からないときは無い
  y?: number;
  theta?: number;
}

/** ラズパイ（serial_bridge）から 1Hz */
export interface RobotInfoTelemetry {
  name: string;              // "1号機"
  esp32: boolean;            // ESP32 とつながっているか
  lidarHz: number;           // LiDAR の更新頻度（0 = 止まっている）
  battery?: number;          // 電池残量 % （0〜100）
  vbat?: number;             // 電池電圧 V
  piTemp?: number;           // ラズパイの CPU 温度 ℃
  fw?: string;               // ESP32 のファーム情報 "1.0.0,BNO055,PCA9685"
  odomDistance: number;      // 起動してから走った距離 m
}

/** telemetry はどちらか一方の形で届く。両方の項目を任意にした型で受けると楽 */
export type AgvTelemetry = Partial<NavTelemetry> & Partial<RobotInfoTelemetry>;

// =====================================================================
// 5. 車両 → Web: agv/{id}/task （QoS 1）
// =====================================================================

export interface TaskProgress {
  taskId: string;
  status: TaskProgressStatus;
  phase: TaskPhase;
  progress: number;          // 0〜100 %
  message: string;           // "Dock-A へ移動中" など
}

// =====================================================================
// 6. 車両 → Web: agv/{id}/emergency （QoS 1）
// =====================================================================

export type EmergencyCode =
  | 'WEB_ESTOP'          // Web の緊急停止ボタン（ラッチ）
  | 'ESTOP_BUTTON'       // 車体の非常停止ボタン（ラッチ）
  | 'US_STOP'            // 超音波で至近距離
  | 'BLOCKED'            // 障害物で長く進めない（source: lidar = ラズパイ / pc1 = Nav2）
  | 'COMM_LOST'          // 走行中に PC1 からの指令が途切れた
  | 'ESP32_LOST'         // ESP32 と通信できない
  | 'LIDAR_FAIL'         // LiDAR が止まっている
  | 'PCA_FAIL'           // PWM 基板が見つからない
  | 'IMU_FAIL'           // ジャイロが見つからない
  | 'LOCALIZATION_LOST'; // 自己位置が分からなくなった

export interface EmergencyEvent {
  code: EmergencyCode;
  reason: string;            // 画面にそのまま出せる日本語
  source: 'pi' | 'esp32' | 'lidar' | 'pc1';
  distance_mm?: number;      // BLOCKED（lidar）のときの障害物までの距離
}

// =====================================================================
// 7. 車両 → Web: agv/{id}/path （表示用、1 秒に 1 回まで）
// =====================================================================

export interface PlannedPath {
  points: [number, number][];            // [x, y] m の並び（間引き済み）
  goal: { x: number; y: number } | null;
}

// =====================================================================
// 8. 車両 → Web: agv/{id}/online （retain。切れると遺言で false）
// =====================================================================

export interface OnlineState {
  online: boolean;           // PC1 の mqtt_bridge が MQTT につながっているか
}

// =====================================================================
// 9. トピック名
// =====================================================================

export const AgvTopics = {
  command: (id: string) => `agv/${id}/command`,
  telemetry: (id: string) => `agv/${id}/telemetry`,
  task: (id: string) => `agv/${id}/task`,
  emergency: (id: string) => `agv/${id}/emergency`,
  path: (id: string) => `agv/${id}/path`,
  online: (id: string) => `agv/${id}/online`,
  broadcastStop: 'agv/broadcast/stop',
} as const;
