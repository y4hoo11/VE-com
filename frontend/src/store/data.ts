// 画面で使うデータの形と、地図・地点・表示名の定義。
// 型・状態名は backend/prisma/schema.prisma と docs/agv_protocol.md に合わせてある。
// バックエンドから届くデータは store.ts でこの形に変換する。

export type VStatus = 'IDLE' | 'RUNNING' | 'CHARGING' | 'ERROR' | 'OFFLINE';
export type TStatus = 'PENDING' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
export type Level = 'INFO' | 'WARN' | 'ERROR';
export type Role = 'ADMIN' | 'OPERATOR' | 'VIEWER';
export type Phase = 'TO_START' | 'LOADING' | 'TO_TARGET' | 'UNLOADING';

export interface Pt {
  x: number;
  y: number;
}

export interface Waypoint {
  name: string;
  label: string;
  x: number;
  y: number;
  aliases: string[];
  charger?: boolean;
}

export interface VErr {
  code: string;
  reason: string;
  latched: boolean; // true = 解除の操作が必要
  source: string;
  at: number;
  clearAt?: number; // モック用: この時刻に自動で戻る
}

export interface Vehicle {
  id: string;
  name: string;
  x: number;
  y: number;
  theta: number;
  status: VStatus;
  battery: number | null;
  // ↓ ROS の telemetry に入っていれば表示する（無ければ null で「—」表示）
  speed: number | null;
  loc: number | null; // 自己位置推定の確かさ 0〜1
  piTemp: number | null;
  esp32: boolean | null;
  lidarHz: number | null;
  vbat: number | null;
  online: boolean;
  paused: boolean;
  wait: number; // 荷積み・荷降ろしの残り秒
  taskId: string | null;
  phase: Phase | null;
  route: Pt[];
  routeTotal: number;
  goal: string | null;
  mode: 'IDLE' | 'TASK' | 'GOTO';
  rosMode: string | null; // PC1 がいま何をしているか（telemetry の mode。NAV・WAIT・HOLD など）
  note: string | null; // rosMode の補足（HOLD の理由など。telemetry の note）
  err: VErr | null;
  prevStatus: VStatus;
  camera: string;
  lastHb: number;
}

export interface Hist {
  at: number;
  status: TStatus;
  note: string;
}

export interface Task {
  id: string;
  no: string; // 画面に出す短い番号（id の先頭8文字）
  title: string;
  start: string;
  target: string;
  priority: number;
  status: TStatus;
  vehicleId: string | null;
  createdBy: string;
  createdAt: number;
  scheduledAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  progress: number | null; // ROS から進捗が届いたときだけ入る
  history: Hist[];
  historyLoaded: boolean; // 状態の変化の履歴を取得済みか
}

export interface Log {
  id: number;
  at: number;
  vid: string | null;
  level: Level;
  message: string;
  details?: Record<string, unknown>;
}

export interface Note {
  id: number;
  vid: string;
  text: string;
  at: number;
  read: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  created: string;
}

// ---------------------------------------------------------------
// 地図・地点は map.ts（ROS 側の地図と waypoints.yaml を読み込む）。ここからも使えるように出しておく
// ---------------------------------------------------------------
export { isFree, planRoute, WAYPOINTS, wpByName } from './map';

export const pathLen = (pts: Pt[]) =>
  pts.slice(1).reduce((s, b, i) => s + Math.hypot(b.x - pts[i].x, b.y - pts[i].y), 0);

// ---------------------------------------------------------------
// 表示名
// ---------------------------------------------------------------
export const ST: Record<VStatus, string> = {
  RUNNING: '稼働中',
  IDLE: '待機中',
  CHARGING: '充電中',
  ERROR: '異常',
  OFFLINE: 'オフライン',
};
export const TS: Record<TStatus, string> = {
  PENDING: '未割当',
  ASSIGNED: '割当済',
  IN_PROGRESS: '実行中',
  COMPLETED: '完了',
  CANCELLED: '取消',
  FAILED: '失敗',
};
// PC1 がいま何をしているか（telemetry の mode。docs/agv_protocol.md 2-2）
// tone: info = ふつう、warn = 止まっていて人が気にした方がよい
export const ROS_MODE: Record<string, { label: string; tone: 'info' | 'warn' }> = {
  NAV: { label: '移動中', tone: 'info' },
  WAIT: { label: '荷積み・荷降ろしの待ち', tone: 'info' },
  MANUAL: { label: '手動操縦中', tone: 'info' },
  PAUSED: { label: '一時停止中', tone: 'warn' },
  HOLD: { label: '止まっています', tone: 'warn' },
  RETRY_WAIT: { label: '経路のやり直し待ち', tone: 'warn' },
};

/** 画面に出す「いまの動作」。何もしていない（IDLE・OFFLINE・未受信）ときは null */
export function rosModeText(v: Pick<Vehicle, 'rosMode' | 'note' | 'online'>) {
  if (!v.online || !v.rosMode || v.rosMode === 'IDLE' || v.rosMode === 'OFFLINE') return null;
  const m = ROS_MODE[v.rosMode] ?? { label: v.rosMode, tone: 'info' as const };
  return { label: m.label, note: v.note || '', tone: m.tone };
}

export const PHASE: Record<Phase, string> = {
  TO_START: '出発地へ移動中',
  LOADING: '荷積み中',
  TO_TARGET: '目的地へ移動中',
  UNLOADING: '荷降ろし中',
};
export const ERR: Record<string, string> = {
  WEB_ESTOP: 'Webの緊急停止',
  ESTOP_BUTTON: '車体の非常停止ボタン',
  US_STOP: '超音波で至近距離',
  BLOCKED: '障害物で停止',
  COMM_LOST: 'PC1からの指令が途切れた',
  ESP32_LOST: 'ESP32と通信できない',
  LIDAR_FAIL: 'LiDAR故障・未接続',
  LOCALIZATION_LOST: '自己位置が不明',
  PCA_FAIL: 'PWM基板の異常',
  IMU_FAIL: 'ジャイロの異常',
  UNKNOWN: '異常',
};

// 解除の操作が必要な異常（docs/agv_protocol.md 2-3 の「ラッチする」もの）。
// 種類が分からない異常も、安全のため「解除が必要」として扱う
export const LATCHED = new Set(['WEB_ESTOP', 'ESTOP_BUTTON', 'UNKNOWN']);
export const COL: Record<VStatus, string> = {
  RUNNING: '#2563eb',
  IDLE: '#16a34a',
  CHARGING: '#0891b2',
  ERROR: '#dc2626',
  OFFLINE: '#9ca3af',
};
export const PAUSED_COL = '#d97706';
