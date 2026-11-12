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