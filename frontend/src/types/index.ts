/**
 * @file index.ts
 * @description フロントエンド・バックエンド共通型定義
 */

// 1. Backend側のPrisma生成型・Enumをそのまま利用
export type {
  User,
  Vehicle,
  Task,
  VehicleLog,
  TaskHistory,
  SystemSetting,
} from '@prisma/client';

export {
  Role,
  VehicleStatus,
  TaskStatus,
  LogLevel,
  SettingCategory,
} from '@prisma/client';

// 2. WebSocket通信用などのリアルタイム更新用ペイロード型定義
export interface VehicleUpdatePayload {
  id: string;
  name?: string;
  status?: import('@prisma/client').VehicleStatus;
  batteryLevel?: number | null;
  currentX?: number | null;
  currentY?: number | null;
  currentTheta?: number | null;
  currentMapId?: string | null;
  emergencyReason?: string | null;
}

export interface LogPayload {
  id: string; // BigIntのシリアライズ処理後のためstring
  vehicleId?: string;
  level: import('@prisma/client').LogLevel;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}