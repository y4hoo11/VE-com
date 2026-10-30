/**
 * @file statusLabels.ts
 * @description DBの状態の値（IDLE など）を、画面に出す日本語に変換する
 */

// 車両の状態（vehicles.status）
export const VEHICLE_STATUS_LABEL: Record<string, string> = {
  IDLE: '待機中',
  RUNNING: '走行中',
  CHARGING: '充電中',
  ERROR: '異常',
  OFFLINE: 'オフライン',
};

// タスクの状態（tasks.status）
export const TASK_STATUS_LABEL: Record<string, string> = {
  PENDING: '未配車',
  ASSIGNED: '配車済み',
  IN_PROGRESS: '実行中',
  COMPLETED: '完了',
  CANCELLED: 'キャンセル',
  FAILED: '失敗',
};

// 一覧にない値が来たときは、そのまま表示する（空なら「不明」）
export const vehicleStatusLabel = (status?: string | null): string =>
  (status && VEHICLE_STATUS_LABEL[status]) || status || '不明';

export const taskStatusLabel = (status?: string | null): string =>
  (status && TASK_STATUS_LABEL[status]) || status || '不明';
