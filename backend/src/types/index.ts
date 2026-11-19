// src/types/index.ts

// タスクの型定義
import {
  Task,
  Vehicle,
  VehicleLog,
  TaskHistory,
  SystemSetting,
  TaskStatus,
  VehicleStatus,
  LogLevel,
  SettingCategory,
} from '@prisma/client';

// Prisma生成型の再エクスポート
export {
  Task,
  Vehicle,
  VehicleLog,
  TaskHistory,
  SystemSetting,
  TaskStatus,
  VehicleStatus,
  LogLevel,
  SettingCategory,
};

// フロントエンド表示用のログエントリ型
export interface LogEntry {
  id: number;
  message: string;
  level: 'info' | 'warn' | 'error' | 'emergency';
  time: string;
}

// フロントエンドとのリアルタイム更新用ペイロード型定義
export interface VehicleUpdatePayload {
  id: string;
  name?: string;
  status?: VehicleStatus;
  batteryLevel?: number | null;
  currentX?: number | null;
  currentY?: number | null;
  currentTheta?: number | null;
  currentMapId?: string | null;
  emergencyReason?: string | null;
  // 異常の種類（docs/agv_protocol.md 2-3 の code と source）。画面で「解除が必要か」を分けるのに使う
  emergencyCode?: string | null;
  emergencySource?: string | null;
  cameraUrl?: string | null; // カメラ映像の URL（車両の設定で変えたとき）
  camera2Url?: string | null;
  // ROS から届いた telemetry のうち、DB に保存しない項目（速度・自己位置の確かさ・温度など）
  // 届いたものだけ入る。画面はこれをそのまま表示する
  telemetry?: VehicleTelemetryExtra;
}

// telemetry の追加項目（docs/agv_protocol.md 2-2）
export interface VehicleTelemetryExtra {
  speed?: number;
  locQuality?: number;
  piTemp?: number;
  esp32?: boolean;
  lidarHz?: number;
  vbat?: number;
  phase?: string;
  goal?: string;
  taskId?: string;
  mode?: string;
  note?: string;
  paused?: boolean; // 一時停止中か（ROS 側に追加をお願いしている項目）
  // 車体まわりの障害物までの距離 [m]（ROS 側に追加をお願いしている項目）
  // scan8: LiDAR を 8 方向に分けた、それぞれの一番近い距離。[前, 左前, 左, 左後, 後, 右後, 右, 右前]（前から反時計回りに 45° ずつ、各 ±22.5°）。点が無い方向は null
  scan8?: (number | null)[];
  usFront?: number | null; // 前の超音波センサー（ESP32 の us_mm を m にしたもの）。未接続・範囲外は null
}

// タスクの進捗（PC1 の agv/{id}/task を画面へ流すもの）
export interface TaskProgressPayload {
  taskId: string;
  vehicleId: string;
  status: string;
  phase: string | null;
  progress: number | null;
  message: string;
}

// Nav2 が計画した経路（PC1 の agv/{id}/path を画面へ流すもの）。座標は地図の m
export interface VehiclePathPayload {
  id: string;
  points: { x: number; y: number }[];
  goal: { x: number; y: number } | null;
}

// LiDAR で見えている物の距離（ラズパイの agv/{id}/clearance）。車体のまわり 8 方向、車体の外形から [cm]
// 物が見えない方向は null。車両詳細ページのアラウンドビューに出す
export const CLEARANCE_KEYS = [
  'frontLeftCorner',
  'frontLeftCenter',
  'frontRightCenter',
  'frontRightCorner',
  'rearLeftCorner',
  'rearLeftCenter',
  'rearRightCenter',
  'rearRightCorner',
] as const;
export type ClearanceKey = (typeof CLEARANCE_KEYS)[number];

export interface VehicleClearancePayload {
  id: string;
  sectors: Record<ClearanceKey, number | null>;
  nearest: number | null;
}

// サーバーの接続状態（画面のヘッダー・お知らせ帯に出す）
export interface SystemStatusPayload {
  mqtt: boolean;
}

// ログ出力用ペイロード型定義
export interface LogPayload {
  id: string;
  vehicleId?: string;
  level: LogLevel;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}