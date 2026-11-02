// モック用のデータ定義と初期データ。
// 型・状態名は backend/prisma/schema.prisma と docs/agv_protocol.md に合わせてある。

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
  speed: number;
  loc: number; // 自己位置推定の確かさ 0〜1
  piTemp: number;
  esp32: boolean;
  lidarHz: number;
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
  progress: number;
  history: Hist[];
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

export const wpByName = (n: string | null | undefined) => WAYPOINTS.find((w) => w.name === n);

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
};
export const COL: Record<VStatus, string> = {
  RUNNING: '#2563eb',
  IDLE: '#16a34a',
  CHARGING: '#0891b2',
  ERROR: '#dc2626',
  OFFLINE: '#9ca3af',
};
export const PAUSED_COL = '#d97706';

// ---------------------------------------------------------------
// 初期データ
// ---------------------------------------------------------------
const MIN = 60_000;

function mkV(id: string, name: string, o: Partial<Vehicle>): Vehicle {
  return {
    id,
    name,
    x: 0,
    y: 0,
    theta: 0,
    status: 'IDLE',
    battery: 80,
    speed: 0,
    loc: 0.93,
    piTemp: 50.2,
    esp32: true,
    lidarHz: 5.5,
    online: true,
    paused: false,
    wait: 0,
    taskId: null,
    phase: null,
    route: [],
    routeTotal: 1,
    goal: null,
    mode: 'IDLE',
    err: null,
    prevStatus: 'IDLE',
    camera: `http://pc1.local:500${id.slice(-1)}/video`,
    lastHb: Date.now(),
    ...o,
  };
}

export function newVehicle(id: string, name: string, camera: string): Vehicle {
  return mkV(id, name, { x: 14.5, y: 8.5, online: false, status: 'OFFLINE', battery: null, camera });
}

type TaskSeed = [string, string, string, string, number, TStatus, string | null, number, [number, TStatus, string][], number?];

export function initialData() {
  const now = Date.now();

  const vehicles: Vehicle[] = [
    mkV('AGV-01', '1号機', {
      x: 5.2,
      y: 5,
      status: 'RUNNING',
      prevStatus: 'RUNNING',
      battery: 83,
      taskId: 'T-1004',
      phase: 'TO_TARGET',
      mode: 'TASK',
      goal: 'Station-1',
      route: [
        { x: 5.2, y: 5 },
        { x: 8, y: 5 },
        { x: 8, y: 8.5 },
      ],
      routeTotal: 13.5,
      loc: 0.92,
    }),
    mkV('AGV-02', '2号機', {
      x: 8,
      y: 3.4,
      theta: Math.PI / 2,
      status: 'ERROR',
      prevStatus: 'RUNNING',
      battery: 64,
      taskId: 'T-1005',
      phase: 'TO_START',
      mode: 'TASK',
      goal: 'Dock-B',
      route: [
        { x: 8, y: 3.4 },
        { x: 8, y: 5 },
        { x: 1.5, y: 5 },
        { x: 1.5, y: 1.5 },
      ],
      routeTotal: 13.5,
      loc: 0.71,
      piTemp: 55.8,
      err: {
        code: 'ESTOP_BUTTON',
        reason: '車体の非常停止ボタンが押されました',
        latched: true,
        source: 'esp32',
        at: now - 1.6 * MIN,
      },
    }),
    mkV('AGV-03', '3号機', { x: 1.5, y: 5, status: 'CHARGING', prevStatus: 'CHARGING', battery: 41, piTemp: 47.3 }),
    mkV('AGV-04', '4号機', { x: 14.5, y: 8.5, theta: Math.PI, status: 'OFFLINE', online: false, battery: null, lastHb: now - 80 * MIN }),
  ];

  const seeds: TaskSeed[] = [
    ['T-1001', '部品トレイ搬送', 'Dock-A', 'Station-1', 3, 'COMPLETED', 'AGV-01', 180, [
      [178, 'ASSIGNED', '車両 [AGV-01] に割り当てました（操作: matsukawa）'],
      [177, 'IN_PROGRESS', '[TO_START] Dock-A へ移動中'],
      [172, 'IN_PROGRESS', '[LOADING] Dock-A で荷積み中'],
      [170, 'IN_PROGRESS', '[TO_TARGET] Station-1 へ移動中'],
      [164, 'COMPLETED', '[UNLOADING] Station-1 で荷降ろし完了'],
    ]],
    ['T-1002', '空箱回収', 'Station-2', 'Dock-B', 2, 'COMPLETED', 'AGV-03', 150, [
      [149, 'ASSIGNED', '車両 [AGV-03] に割り当てました（操作: tanaka）'],
      [148, 'IN_PROGRESS', '[TO_START] Station-2 へ移動中'],
      [140, 'IN_PROGRESS', '[TO_TARGET] Dock-B へ移動中'],
      [133, 'COMPLETED', '[UNLOADING] Dock-B で荷降ろし完了'],
    ]],
    ['T-1003', '検査品搬送', 'Dock-B', 'Station-3', 4, 'FAILED', 'AGV-02', 120, [
      [118, 'ASSIGNED', '車両 [AGV-02] に割り当てました（操作: matsukawa）'],
      [117, 'IN_PROGRESS', '[TO_START] Dock-B へ移動中'],
      [110, 'IN_PROGRESS', '[TO_TARGET] Station-3 へ移動中'],
      [108, 'FAILED', '経路上の障害物で 60 秒以上進めませんでした'],
    ]],
    ['T-1004', '部品トレイ搬送（第2便）', 'Dock-A', 'Station-1', 4, 'IN_PROGRESS', 'AGV-01', 40, [
      [22, 'ASSIGNED', '車両 [AGV-01] に割り当てました（操作: matsukawa）'],
      [21, 'IN_PROGRESS', '[TO_START] Dock-A へ移動中'],
      [12, 'IN_PROGRESS', '[LOADING] Dock-A で荷積み中'],
      [10, 'IN_PROGRESS', '[TO_TARGET] Station-1 へ移動中'],
    ]],
    ['T-1005', '資材補充', 'Dock-B', 'Station-2', 3, 'IN_PROGRESS', 'AGV-02', 30, [
      [8, 'ASSIGNED', '車両 [AGV-02] に割り当てました（操作: tanaka）'],
      [7, 'IN_PROGRESS', '[TO_START] Dock-B へ移動中'],
    ]],
    ['T-1006', '完成品出荷', 'Station-3', 'Dock-A', 5, 'PENDING', null, 15, []],
    ['T-1007', '工具返却', 'Station-1', 'Dock-B', 2, 'PENDING', null, 12, [], 90],
    ['T-1008', '梱包材補充', 'Dock-B', 'A13', 3, 'PENDING', null, 5, []],
    ['T-1009', '走行テスト', 'Home', 'Station-1', 1, 'CANCELLED', null, 200, [[195, 'CANCELLED', '取り消しました（操作: admin）']]],
  ];

  const tasks: Task[] = seeds.map(([id, title, start, target, priority, status, vid, ago, hs, schedIn]) => {
    const createdAt = now - ago * MIN;
    const history = [
      { at: createdAt, status: 'PENDING' as TStatus, note: 'タスクを作成しました' },
      ...hs.map(([m, s, note]) => ({ at: now - m * MIN, status: s, note })),
    ];
    const firstRun = history.find((h) => h.status === 'IN_PROGRESS');
    const done = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(status) ? history[history.length - 1] : undefined;
    return {
      id,
      title,
      start,
      target,
      priority,
      status,
      vehicleId: vid,
      createdBy: ago > 140 ? 'tanaka' : 'matsukawa',
      createdAt,
      scheduledAt: schedIn ? now + schedIn * MIN : null,
      startedAt: firstRun?.at ?? null,
      completedAt: done?.at ?? null,
      progress: status === 'COMPLETED' ? 100 : 0,
      history,
    };
  });

  const logSeeds: [number, string | null, Level, string, Record<string, unknown>?][] = [
    [200, null, 'INFO', 'サーバーを起動しました（MQTT: mqtt://localhost:1883）'],
    [164, 'AGV-01', 'INFO', '部品トレイ搬送: 完了しました'],
    [149, 'AGV-03', 'INFO', 'AGV-03 にタスク [空箱回収] を割り当てました'],
    [133, 'AGV-03', 'INFO', '空箱回収: 完了しました'],
    [118, 'AGV-02', 'INFO', 'AGV-02 にタスク [検査品搬送] を割り当てました'],
    [109, 'AGV-02', 'WARN', '障害物で停止: 前方障害物で15秒停止中', { code: 'BLOCKED', source: 'pc1', distance_mm: 240 }],
    [108, 'AGV-02', 'ERROR', '検査品搬送: 経路上の障害物で 60 秒以上進めませんでした', { taskId: 'T-1003', status: 'FAILED' }],
    [95, 'AGV-04', 'WARN', 'バッテリー残量が 25% になりました', { battery: 25, vbat: 6.94 }],
    [80, 'AGV-04', 'ERROR', '車両からのデータが途切れました（OFFLINE）', { online: false }],
    [60, 'AGV-03', 'INFO', 'Home に到着しました（充電中）'],
    [22, 'AGV-01', 'INFO', 'AGV-01 にタスク [部品トレイ搬送（第2便）] を割り当てました'],
    [12, 'AGV-01', 'INFO', '部品トレイ搬送（第2便）: Dock-A に到着、荷積み中'],
    [8, 'AGV-02', 'INFO', 'AGV-02 にタスク [資材補充] を割り当てました'],
    [3, 'AGV-02', 'WARN', '自己位置の確かさが 71% に下がりました', { locQuality: 0.71 }],
    [1.6, 'AGV-02', 'ERROR', '車体の非常停止ボタン: 車体の非常停止ボタンが押されました', { code: 'ESTOP_BUTTON', source: 'esp32' }],
  ];
  const logs: Log[] = logSeeds
    .map(([m, vid, level, message, details], i) => ({ id: i + 1, at: now - m * MIN, vid, level, message, details }))
    .sort((a, b) => b.at - a.at);

  const notes: Note[] = [
    { id: 1, vid: 'AGV-02', text: '2号機: 車体の非常停止ボタン', at: now - 1.6 * MIN, read: false },
    { id: 2, vid: 'AGV-04', text: '4号機: データが途切れました（OFFLINE）', at: now - 80 * MIN, read: true },
  ];

  const users: User[] = [
    { id: 'u1', name: 'admin', email: 'admin@ve-con.local', role: 'ADMIN', created: '2026-09-01' },
    { id: 'u2', name: 'matsukawa', email: 'matsukawa@ve-con.local', role: 'OPERATOR', created: '2026-09-03' },
    { id: 'u3', name: 'tanaka', email: 'tanaka@ve-con.local', role: 'OPERATOR', created: '2026-09-10' },
    { id: 'u4', name: 'viewer01', email: 'viewer01@ve-con.local', role: 'VIEWER', created: '2026-10-02' },
  ];

  return { vehicles, tasks, logs, notes, users };
}
