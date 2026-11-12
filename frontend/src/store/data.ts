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
// 地図（モック用の簡略図。16m x 10m、左下が (0,0)）
// 地点名は edge_ai/.../waypoints.yaml と同じ。座標はこの簡略図用に置き直している
// ---------------------------------------------------------------
export const MAP_W = 16;
export const MAP_H = 10;
export const AISLE_Y = 5; // 横の通路

export const WAYPOINTS: Waypoint[] = [
  { name: 'Home', label: '待機・充電', x: 1.5, y: 5, aliases: ['home', '充電ステーション'], charger: true },
  { name: 'Dock-A', label: '入荷口A', x: 1.5, y: 8.5, aliases: ['DockA', '入荷口A'] },
  { name: 'Dock-B', label: '入荷口B', x: 1.5, y: 1.5, aliases: ['DockB', '入荷口B'] },
  { name: 'A13', label: '棚A13', x: 6, y: 5, aliases: ['棚A13'] },
  { name: 'Station-1', label: '作業場1', x: 8, y: 8.5, aliases: ['Station1', '1', '部屋'] },
  { name: 'Station-2', label: '作業場2', x: 8, y: 1.5, aliases: ['Station2', '2'] },
  { name: 'Station-3', label: '作業場3', x: 14.5, y: 5, aliases: ['Station3', '3'] },
];

// [x, y, 幅, 高さ]（左下基準, m）
export const SHELVES: [number, number, number, number][] = [
  [4.8, 6.2, 2.4, 1.2],
  [8.8, 6.2, 2.4, 1.2],
  [4.8, 2.6, 2.4, 1.2],
  [8.8, 2.6, 2.4, 1.2],
  [12.8, 6.4, 1, 2.8],
];
export const OFFICE: [number, number, number, number] = [12.2, 0, 3.8, 2.6];
export const ZONES = [
  { x: 0.2, y: 7.3, w: 2.6, h: 2.5, label: '入荷口A' },
  { x: 0.2, y: 0.2, w: 2.6, h: 2.5, label: '入荷口B' },
  { x: 0.2, y: 4.2, w: 2.6, h: 1.6, label: '充電' },
];

// 地点名か別名で探す（ROS の waypoints.yaml と同じく、別名でも指定できる）
export const wpByName = (n: string | null | undefined) =>
  n ? WAYPOINTS.find((w) => w.name === n || w.aliases.includes(n)) : undefined;

// 走れる場所か（壁ぎわ・棚・事務所は不可）
export function isFree(p: Pt): boolean {
  const m = 0.3;
  if (p.x < m || p.y < m || p.x > MAP_W - m || p.y > MAP_H - m) return false;
  return ![...SHELVES, OFFICE].some(([x, y, w, h]) => p.x > x - m && p.x < x + w + m && p.y > y - m && p.y < y + h + m);
}

// 簡易な経路（通路 y=5 を経由する）。本物は Nav2 が計画する
export function makeRoute(from: Pt, to: Pt): Pt[] {
  const p: Pt[] = [{ x: from.x, y: from.y }];
  if (Math.abs(from.y - AISLE_Y) > 0.05) p.push({ x: from.x, y: AISLE_Y });
  if (Math.abs(from.x - to.x) > 0.05) p.push({ x: to.x, y: AISLE_Y });
  if (Math.abs(to.y - AISLE_Y) > 0.05 || p.length === 1) p.push({ x: to.x, y: to.y });
  return p;
}

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

// ---------------------------------------------------------------
// 設定変更の申請（setting_classification.xlsx の「設定項目の分類」「ランク定義」）
// 項目・範囲・既定値は backend/src/controllers/changeRequestController.ts の SETTING_ITEMS と合わせる
// ---------------------------------------------------------------
export type Rank = 1 | 2 | 3;
export type SettingItem = { key: string; label: string; rank: Rank; scope: string; def: string } & (
  | { type: 'number'; unit: string; deltaUnit?: string; min: number; max: number; step: number; hardLimit?: boolean }
  | { type: 'text'; placeholder: string }
  | { type: 'select'; options: string[] }
);

// 【仮】申請できる範囲は仮の値
export const SETTING_ITEMS: SettingItem[] = [
  { key: 'logRetention', label: 'ログの保存期間', rank: 1, scope: '全社', def: '90', type: 'number', unit: '日', min: 30, max: 365, step: 1 },
  { key: 'battWarn', label: 'バッテリー警告のしきい値', rank: 2, scope: '全車両', def: '30', type: 'number', unit: '%', deltaUnit: 'ポイント', min: 10, max: 50, step: 1 },
  { key: 'battMin', label: '割り当てない残量（充電に戻る基準）', rank: 2, scope: '全車両', def: '20', type: 'number', unit: '%', deltaUnit: 'ポイント', min: 10, max: 50, step: 1 },
  { key: 'hours', label: '稼働時間帯（走行を許可する時間）', rank: 2, scope: '全車両', def: '終日', type: 'text', placeholder: '例：08:00〜18:00' },
  { key: 'waypoints', label: '登録地点（経由地・目的地）の追加・位置変更', rank: 2, scope: '全車両', def: '現在の登録地点', type: 'text', placeholder: '追加・移動する地点と、その位置' },
  { key: 'maxSpeed', label: '最高速度（agv.max_speed）', rank: 3, scope: '全車両', def: '5', type: 'number', unit: 'km/h', min: 1, max: 6, step: 0.5, hardLimit: true },
  { key: 'obstacle', label: '障害物検知で減速・停止を始める距離', rank: 3, scope: '全車両', def: '0.45', type: 'number', unit: 'm', min: 0.2, max: 2, step: 0.05 },
  { key: 'keepout', label: '立入禁止エリアの追加・削除', rank: 3, scope: '全車両', def: '未設定', type: 'text', placeholder: '追加・削除するエリアと、その範囲' },
  { key: 'map', label: '使用する地図の切り替え', rank: 3, scope: '全車両', def: 'warehouse_map', type: 'select', options: ['warehouse_map', 'warehouse_a', 'warehouse_b', 'demo_map', 'simple', 'maze'] },
];
export const settingItem = (key: string) => SETTING_ITEMS.find((i) => i.key === key);
export const fmtSetting = (key: string, v: string | null | undefined) => {
  const i = settingItem(key);
  return v == null ? '—' : i?.type === 'number' ? `${v} ${i.unit}` : v;
};

/** 希望する値の確かめ（画面側。サーバーでも同じ確認をする） */
export function valueError(item: SettingItem, raw: string, cur: string): string | null {
  const v = raw.trim();
  if (!v) return '希望する値を入力してください';
  if (v === cur) return '現在の値と同じです';
  if (item.type === 'number') {
    const n = Number(v);
    if (!Number.isFinite(n)) return '数値で入力してください';
    if (item.step >= 1 && !Number.isInteger(n)) return '整数で入力してください';
    if (n < item.min || n > item.max) return `${item.min}〜${item.max} ${item.unit} の範囲で入力してください`;
  }
  return null;
}

// 必要な承認の人数（申請者以外の管理者）
export const needApprovals = (rank: number) => (rank >= 3 ? 2 : 1);

export const RANKS = {
  1: { short: 'L1', name: '低', desc: '安全に関係せず、すぐ元に戻せる。全車両に影響しても、見え方や通知の範囲にとどまる', badge: '危険度 L1（低）', tone: 'green', cls: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300', sub: '変更したい項目を選び、理由を添えて申請します。', approvers: 1, need: '最高権限者 1 人', step: '最高権限者 1 人', when: 'すぐに反映', reflect: '承認されると、すぐに設定へ反映されます。' },
  2: { short: 'L2', name: '中', desc: '車両の動きに間接的に影響する。誤ると効率が落ちたり車両が止まったりするが、衝突などの危険は直接ない', badge: '危険度 L2（中）', tone: 'amber', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300', sub: '変更したい項目を選び、理由と効果を添えて申請します。', approvers: 1, need: '最高権限者 1 人', step: '最高権限者 1 人', when: '次の待機時', reflect: '走行中の車両には、次の待機時に反映されます。' },
  3: { short: 'L3', name: '高', desc: '車両の動きや安全に直結する。誤ると衝突・接触や、人への危険につながる', badge: '危険度 L3（高）', tone: 'red', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300', sub: '理由・効果・安全ルール案を添えて、誓約のうえ申請します。', approvers: 2, need: '申請者以外の最高権限者 2 人', step: '最高権限者 2 人', when: '停止中のみ', reflect: '対象の車両が停止中のときだけ反映されます。SHRAGD にも通知されます。' },
} as const;

export type ReqStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'APPLIED';
export const REQ_STATUS: Record<ReqStatus, { label: string; cls: string }> = {
  PENDING: { label: '承認待ち', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  APPROVED: { label: '変更待ち', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  REJECTED: { label: '不承認', cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
  WITHDRAWN: { label: '取り下げ', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400' },
  APPLIED: { label: '変更済み', cls: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300' },
};

export interface Review {
  name: string;
  decision: 'APPROVE' | 'REJECT';
  comment: string;
  at: number;
}

export interface ChangeRequest {
  id: string;
  key: string;
  label: string;
  rank: Rank;
  cur: string; // 申請したときの値
  value: string; // 希望する値
  reason: string;
  effect: string;
  rule: string;
  pledgedAt: number | null;
  status: ReqStatus;
  direct: boolean; // 管理者が申請なしで変更した記録
  requester: string;
  reviews: Review[];
  appliedValue: string | null;
  appliedBy: string | null;
  signature: string | null;
  appliedAt: number | null;
  at: number;
  updatedAt: number;
}
export const approvalsOf = (r: ChangeRequest) => r.reviews.filter((v) => v.decision === 'APPROVE');
export const isOpenReq = (r: ChangeRequest) => r.status === 'PENDING' || r.status === 'APPROVED';
