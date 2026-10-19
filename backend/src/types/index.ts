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