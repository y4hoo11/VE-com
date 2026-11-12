// 【仮】デモモード：実機がなくても画面の動きを確かめるための、ブラウザ内だけで動く偽のサーバー。
// api.ts と socket.ts の入口で実サーバーの代わりに呼ばれるので、デモ中はサーバー・DB・MQTT へ何も送らない。
// データはメモリにあるだけで、再読み込みやデモの切り替えで最初に戻る。
// 実機で確認できるようになったら、このファイルと【仮】の付いた呼び出しを消す。
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { isFree, makeRoute, needApprovals, pathLen, SETTING_ITEMS, settingItem, valueError, wpByName, type Level, type Phase, type Pt, type ReqStatus, type TStatus, type VStatus } from '../store/data';

const TICK_MS = 200;
const SPEED = 0.8; // m/s（実機より速め。見ていて分かるように）
const TURN_SPEED = 2.5; // rad/s
const WAIT_SEC = 5; // 荷積み・荷降ろしにかかる秒数
const DRAIN_PER_SEC = 0.1; // 走行中に減るバッテリー（%）
const CHARGE_PER_SEC = 0.5; // 充電中に増えるバッテリー（%）

type DemoVehicle = {
  id: string;
  name: string;
  status: VStatus;
  prevStatus: VStatus;
  x: number;
  y: number;
  theta: number;
  battery: number;
  speed: number;
  paused: boolean;
  route: Pt[];
  routeTotal: number;
  goal: string | null;
  mode: 'IDLE' | 'TASK' | 'GOTO';
  phase: Phase | null;
  wait: number;
  taskId: string | null;
  lastHb: number;
};
type DemoHistory = { status: TStatus; note: string; timestamp: string };
type DemoTask = {
  id: string;
  title: string;
  status: TStatus;
  priority: number;
  assignedVehicleId: string | null;
  startLocation: string;
  targetLocation: string;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  createdByUser: { username: string };
  progress: number | null;
  histories: DemoHistory[];
};
type DemoLog = { id: string; vehicleId: string | null; level: Level; message: string; details: Record<string, unknown> | null; timestamp: string };

// ---------------------------------------------------------------
// 切り替えとイベント（画面側は Socket.IO と同じ名前で受け取る）
// ---------------------------------------------------------------
let enabled = false;
let timer: ReturnType<typeof setInterval> | null = null;
let lastTick = 0;
let tickCount = 0;

const handlers = new Map<string, Set<(payload: unknown) => void>>();
export function demoOn<T>(event: string, fn: (payload: T) => void) {
  const set = handlers.get(event) ?? new Set();
  set.add((payload) => fn(payload as T));
  handlers.set(event, set);
}
const fire = (event: string, payload?: unknown) => handlers.get(event)?.forEach((f) => f(payload));

export const isDemo = () => enabled;

export function setDemoEnabled(on: boolean) {
  enabled = on;
  if (timer) clearInterval(timer);
  timer = null;
  if (!on) return;
  resetDemo();
  lastTick = Date.now();
  timer = setInterval(tick, TICK_MS);
}

// ---------------------------------------------------------------
// デモのデータ
// ---------------------------------------------------------------
let vehicles: DemoVehicle[] = [];
let tasks: DemoTask[] = [];
let logs: DemoLog[] = [];
let ops = { battWarn: 30, battMin: 20 };
let logSeq = 1;
let taskSeq = 1;

const iso = (t = Date.now()) => new Date(t).toISOString();
const wpPt = (name: string): Pt => {
  const w = wpByName(name);
  return w ? { x: w.x, y: w.y } : { x: 1.5, y: 5 };
};

function makeVehicle(id: string, name: string, at: string, status: VStatus, battery: number): DemoVehicle {
  const p = wpPt(at);
  return { id, name, status, prevStatus: status, x: p.x, y: p.y, theta: 0, battery, speed: 0, paused: false, route: [], routeTotal: 1, goal: null, mode: 'IDLE', phase: null, wait: 0, taskId: null, lastHb: Date.now() };
}
function makeTask(title: string, start: string, target: string, priority: number, createdAt = Date.now()): DemoTask {
  return {
    id: `demo-${String(taskSeq++).padStart(3, '0')}`,
    title,
    status: 'PENDING',
    priority,
    assignedVehicleId: null,
    startLocation: start,
    targetLocation: target,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    createdAt: iso(createdAt),
    createdByUser: { username: 'demo' },
    progress: null,
    histories: [{ status: 'PENDING', note: 'タスクが新規作成されました', timestamp: iso(createdAt) }],
  };
}
function setTaskStatus(t: DemoTask, status: TStatus, note: string) {
  t.status = status;
  t.histories.unshift({ status, note, timestamp: iso() });
}
function addLog(vehicleId: string | null, level: Level, message: string, details: Record<string, unknown> | null = null, at = Date.now(), silent = false) {
  const log: DemoLog = { id: String(logSeq++), vehicleId, level, message, details, timestamp: iso(at) };
  logs.unshift(log);
  if (logs.length > 2000) logs.length = 2000;
  if (!silent) fire('log:new', log);
}

// 最初の状態。走っている車両・充電中・電池不足・オフラインを1台ずつ
export function resetDemo() {
  taskSeq = 1;
  logSeq = 1;
  logs = [];
  ops = { battWarn: 30, battMin: 20 };
  resetRequests();
  const t = Date.now();
  vehicles = [
    makeVehicle('AGV-91', 'デモ1号機', 'Dock-A', 'RUNNING', 84),
    makeVehicle('AGV-92', 'デモ2号機', 'Home', 'CHARGING', 62),
    makeVehicle('AGV-93', 'デモ3号機', 'Station-2', 'IDLE', 15),
    makeVehicle('AGV-94', 'デモ4号機', 'Station-3', 'OFFLINE', 48),
  ];
  const done = makeTask('棚A13へ補充（完了済み）', 'Dock-B', 'A13', 1, t - 3600_000);
  done.assignedVehicleId = 'AGV-93';
  done.startedAt = iso(t - 3500_000);
  done.completedAt = iso(t - 3300_000);
  done.progress = 100;
  done.status = 'COMPLETED';
  done.histories.unshift({ status: 'COMPLETED', note: 'タスクが完了しました', timestamp: done.completedAt });

  const running = makeTask('入荷口Aから作業場3へ搬送', 'Dock-A', 'Station-3', 2, t - 60_000);
  const pending1 = makeTask('入荷口Bから作業場1へ搬送', 'Dock-B', 'Station-1', 1, t - 30_000);
  const pending2 = makeTask('棚A13から作業場2へ搬送', 'A13', 'Station-2', 0, t - 10_000);
  tasks = [pending2, pending1, running, done];

  addLog('AGV-93', 'INFO', `${done.id} が完了しました`, null, t - 3300_000, true);
  addLog('AGV-94', 'WARN', '通信が5秒以上届かないため、オフラインにしました', null, t - 600_000, true);
  addLog('AGV-93', 'WARN', 'バッテリーの残量が少なくなっています', null, t - 120_000, true);
  addLog(null, 'INFO', 'デモモードを開始しました', null, t, true);

  // 1号機は積み込みを終えて、作業場3へ向かうところから始める
  const v = vehicles[0];
  running.assignedVehicleId = v.id;
  running.startedAt = iso(t - 30_000);
  setTaskStatus(running, 'ASSIGNED', `${v.name} に割り当てました`);
  setTaskStatus(running, 'IN_PROGRESS', '車両が出発地に到着しました');
  v.taskId = running.id;
  v.mode = 'TASK';
  startRoute(v, wpPt(running.targetLocation), running.targetLocation, 'TO_TARGET');
  fire('vehicles:changed');
  fire('tasks:changed');
}

// ---------------------------------------------------------------
// シミュレーション
// ---------------------------------------------------------------
const normAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const taskOf = (v: DemoVehicle) => tasks.find((t) => t.id === v.taskId);
const clampProgress = (n: number) => Math.round(Math.min(100, Math.max(0, n)));

function startRoute(v: DemoVehicle, to: Pt, goal: string, phase: Phase | null) {
  v.route = makeRoute(v, to);
  v.routeTotal = Math.max(pathLen(v.route), 0.01);
  v.goal = goal;
  v.phase = phase;
  v.wait = 0;
  v.status = 'RUNNING';
}

function finishMove(v: DemoVehicle) {
  v.route = [];
  v.speed = 0;
  if (v.mode === 'GOTO') {
    const home = v.goal === 'Home';
    addLog(v.id, 'INFO', `${v.goal} に到着しました`);
    v.mode = 'IDLE';
    v.goal = null;
    v.status = home ? 'CHARGING' : 'IDLE';
    return;
  }
  const t = taskOf(v);
  if (!t) {
    v.status = 'IDLE';
    return;
  }
  if (v.phase === 'TO_START') {
    t.startedAt = iso();
    setTaskStatus(t, 'IN_PROGRESS', '車両が出発地に到着しました');
    addLog(v.id, 'INFO', `${t.id}: 出発地 ${t.startLocation} に到着し、荷積みを始めました`);
    v.phase = 'LOADING';
    v.wait = WAIT_SEC;
    fire('tasks:changed');
  } else if (v.phase === 'TO_TARGET') {
    addLog(v.id, 'INFO', `${t.id}: 目的地 ${t.targetLocation} に到着し、荷降ろしを始めました`);
    v.phase = 'UNLOADING';
    v.wait = WAIT_SEC;
  }
}

function finishWait(v: DemoVehicle) {
  const t = taskOf(v);
  v.wait = 0;
  if (!t) return;
  if (v.phase === 'LOADING') {
    startRoute(v, wpPt(t.targetLocation), t.targetLocation, 'TO_TARGET');
  } else if (v.phase === 'UNLOADING') {
    t.completedAt = iso();
    t.progress = 100;
    setTaskStatus(t, 'COMPLETED', 'タスクが完了しました');
    addLog(v.id, 'INFO', `${t.id} が完了しました`);
    clearVehicleTask(v);
    fire('tasks:changed');
  }
}

function clearVehicleTask(v: DemoVehicle) {
  v.taskId = null;
  v.mode = 'IDLE';
  v.phase = null;
  v.route = [];
  v.goal = null;
  v.wait = 0;
  v.paused = false;
  v.speed = 0;
  if (v.status === 'RUNNING') v.status = 'IDLE';
}

function moveAlongRoute(v: DemoVehicle, dt: number) {
  const target = v.route[1];
  const dx = target.x - v.x;
  const dy = target.y - v.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.01) {
    v.route.shift();
    return;
  }
  // まず行きたい方向を向いてから進む（地図の矢印が曲がるのが見えるように）
  const diff = normAngle(Math.atan2(dy, dx) - v.theta);
  const turn = TURN_SPEED * dt;
  v.theta = normAngle(Math.abs(diff) <= turn ? v.theta + diff : v.theta + Math.sign(diff) * turn);
  if (Math.abs(diff) > 0.35) {
    v.speed = 0;
    return;
  }
  const step = SPEED * dt;
  v.speed = SPEED;
  v.battery = Math.max(0, v.battery - DRAIN_PER_SEC * dt);
  if (step >= dist) {
    v.x = target.x;
    v.y = target.y;
    v.route.shift();
  } else {
    v.x += (dx / dist) * step;
    v.y += (dy / dist) * step;
  }
  v.route[0] = { x: v.x, y: v.y };
}

function updateProgress(v: DemoVehicle) {
  const t = taskOf(v);
  if (!t) return;
  const moved = v.route.length > 1 ? 1 - pathLen(v.route) / v.routeTotal : 1;
  const waited = 1 - v.wait / WAIT_SEC;
  if (v.phase === 'TO_START') t.progress = clampProgress(25 * moved);
  else if (v.phase === 'LOADING') t.progress = clampProgress(25 + 15 * waited);
  else if (v.phase === 'TO_TARGET') t.progress = clampProgress(40 + 45 * moved);
  else if (v.phase === 'UNLOADING') t.progress = clampProgress(85 + 15 * waited);
}

function sendUpdate(v: DemoVehicle) {
  v.lastHb = Date.now();
  fire('vehicle:update', {
    id: v.id,
    name: v.name,
    status: v.status,
    batteryLevel: Math.round(v.battery * 10) / 10,
    currentX: v.x,
    currentY: v.y,
    currentTheta: v.theta,
    telemetry: {
      speed: v.speed,
      locQuality: 0.97,
      piTemp: 47 + Math.sin(Date.now() / 20000) * 2,
      esp32: true,
      lidarHz: 10,
      vbat: 6.4 + v.battery * 0.018,
      phase: v.phase ?? '',
      goal: v.goal ?? '',
    },
    demo: { paused: v.paused, route: v.route.map((p) => ({ ...p })), routeTotal: v.routeTotal, mode: v.mode, wait: v.wait, progress: taskOf(v)?.progress ?? null },
  });
}

function tick() {
  const t = Date.now();
  const dt = Math.min((t - lastTick) / 1000, 1); // 裏のタブでタイマーが遅れても、飛びすぎないように
  lastTick = t;
  tickCount++;
  for (const v of vehicles) {
    if (v.status === 'OFFLINE') continue;
    let busy = false;
    if (v.status !== 'ERROR') {
      if (v.status === 'CHARGING') {
        v.battery = Math.min(100, v.battery + CHARGE_PER_SEC * dt);
        if (v.battery >= 100) v.status = 'IDLE';
      }
      if (!v.paused && v.route.length > 1) {
        busy = true;
        moveAlongRoute(v, dt);
        if (v.route.length <= 1) finishMove(v);
      } else if (!v.paused && v.wait > 0) {
        busy = true;
        v.wait -= dt;
        if (v.wait <= 0) finishWait(v);
      } else {
        v.speed = 0;
      }
      updateProgress(v);
    }
    if (busy || tickCount % 5 === 0) sendUpdate(v);
  }
}

// ---------------------------------------------------------------
// 車両への命令（今は実機向けの命令が無いので、デモのときだけ動く）。問題があれば理由を返す
// ---------------------------------------------------------------
const need = (id: string) => vehicles.find((x) => x.id === id);
function whyNotMove(v: DemoVehicle | undefined) {
  if (!v) return '車両が見つかりません';
  if (v.status === 'OFFLINE') return 'オフラインの車両は操作できません';
  if (v.status === 'ERROR') return '異常中の車両は操作できません。先に緊急状態を解除してください';
  if (v.taskId) return 'タスクを実行中です。先にタスクを中止してください';
  return null;
}

export const demoCommand = {
  pause(id: string) {
    const v = need(id);
    if (!v || v.status !== 'RUNNING') return '動いていない車両は一時停止できません';
    v.paused = true;
    v.speed = 0;
    addLog(v.id, 'INFO', '一時停止しました');
    sendUpdate(v);
    return null;
  },
  resume(id: string) {
    const v = need(id);
    if (!v || !v.paused) return '一時停止していません';
    v.paused = false;
    addLog(v.id, 'INFO', '再開しました');
    sendUpdate(v);
    return null;
  },
  confirmLoad(id: string) {
    const v = need(id);
    if (!v || v.wait <= 0) return '荷積み・荷降ろしの最中ではありません';
    v.wait = 0.01;
    return null;
  },
  goto(id: string, to: Pt, goal: string) {
    const v = need(id);
    const ng = whyNotMove(v);
    if (ng || !v) return ng;
    if (!isFree(to)) return 'そこには移動できません（棚・壁・事務所の近く）';
    v.mode = 'GOTO';
    v.paused = false;
    startRoute(v, to, goal, null);
    addLog(v.id, 'INFO', `${goal} への移動を始めました`);
    sendUpdate(v);
    return null;
  },
  setPose(id: string, p: Pt, theta: number) {
    const v = need(id);
    const ng = whyNotMove(v);
    if (ng || !v) return ng;
    if (v.mode === 'GOTO') return '移動中は現在地を設定できません';
    v.x = p.x;
    v.y = p.y;
    v.theta = theta;
    addLog(v.id, 'INFO', `現在地を設定しました（x ${p.x.toFixed(2)} / y ${p.y.toFixed(2)}）`);
    sendUpdate(v);
    return null;
  },
};

// ---------------------------------------------------------------
// Socket.IO の代わり（緊急停止・解除）
// ---------------------------------------------------------------
export function demoAck(event: string, data: unknown): { ok: boolean; error?: string } {
  const id = (data as { vehicleId?: string } | null)?.vehicleId;
  const v = vehicles.find((x) => x.id === id);
  if (!v) return { ok: false, error: '車両が見つかりません' };
  if (event === 'manual_emergency_stop') {
    if (v.status === 'OFFLINE') return { ok: false, error: 'オフラインの車両には送れません' };
    if (v.status !== 'ERROR') v.prevStatus = v.status;
    v.status = 'ERROR';
    v.speed = 0;
    const reason = 'Web画面から緊急停止しました';
    addLog(v.id, 'ERROR', reason, { code: 'WEB_ESTOP', source: 'web', reason });
    fire('vehicle:update', { id: v.id, status: 'ERROR', emergencyReason: reason, emergencyCode: 'WEB_ESTOP', emergencySource: 'web' });
    return { ok: true };
  }
  if (event === 'acknowledge_emergency') {
    if (v.status !== 'ERROR') return { ok: false, error: 'この車両は異常中ではありません' };
    v.status = v.prevStatus === 'ERROR' ? 'IDLE' : v.prevStatus;
    addLog(v.id, 'INFO', '緊急状態を解除しました');
    sendUpdate(v);
    return { ok: true };
  }
  return { ok: false, error: `デモでは未対応です: ${event}` };
}

// ---------------------------------------------------------------
// REST API の代わり（backend/src/routes/index.ts と同じ形で返す）
// ---------------------------------------------------------------
type Result = { status: number; data: unknown; headers?: Record<string, string> };
const ok = (data: unknown, status = 200): Result => ({ status, data });
const fail = (status: number, error: string): Result => ({ status, data: { error } });

const vehicleJson = (v: DemoVehicle) => ({
  id: v.id,
  name: v.name,
  status: v.status,
  batteryLevel: Math.round(v.battery * 10) / 10,
  currentX: v.x,
  currentY: v.y,
  currentTheta: v.theta,
  currentMapId: 'demo',
  lastHeartbeat: iso(v.lastHb),
});

function getLogs(params: Record<string, unknown>): Result {
  const levels = typeof params.level === 'string' ? params.level.split(',') : null;
  const from = typeof params.from === 'string' ? Date.parse(params.from) : null;
  const to = typeof params.to === 'string' ? Date.parse(params.to) : null;
  const q = typeof params.q === 'string' ? params.q : '';
  const list = logs.filter((l) => {
    const at = Date.parse(l.timestamp);
    return (
      (!params.vehicleId || l.vehicleId === params.vehicleId) &&
      (!levels || levels.includes(l.level)) &&
      (from == null || at >= from) &&
      (to == null || at <= to) &&
      (!q || l.message.includes(q))
    );
  });
  const offset = Number(params.offset ?? 0);
  const limit = Math.min(Number(params.limit ?? 100), 1000);
  return { status: 200, data: list.slice(offset, offset + limit), headers: { 'x-total-count': String(list.length) } };
}

function assignTask(body: Record<string, unknown>): Result {
  const t = tasks.find((x) => x.id === body.taskId);
  const v = vehicles.find((x) => x.id === body.vehicleId);
  if (!t) return fail(404, 'タスクが見つかりません');
  if (!v) return fail(404, '車両が見つかりません');
  if (t.status !== 'PENDING') return fail(409, 'このタスクは割り当て待ちではありません');
  if (v.status === 'OFFLINE') return fail(409, 'この車両はオフラインのため割り当てられません');
  if (v.status === 'ERROR') return fail(409, 'この車両は異常中のため割り当てられません');
  if (v.taskId || v.mode === 'GOTO') return fail(409, 'この車両は別のタスクを実行中です');
  if (v.battery < ops.battMin) return fail(409, `電池残量が ${ops.battMin}% 未満のため割り当てられません`);

  t.assignedVehicleId = v.id;
  t.progress = 0;
  setTaskStatus(t, 'ASSIGNED', `${v.name} に割り当てました`);
  v.taskId = t.id;
  v.mode = 'TASK';
  startRoute(v, wpPt(t.startLocation), t.startLocation, 'TO_START');
  addLog(v.id, 'INFO', `${t.id} を割り当てました（${t.startLocation} → ${t.targetLocation}）`);
  sendUpdate(v);
  fire('tasks:changed');
  return ok(t);
}

function readTask(body: Record<string, unknown>) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const start = wpByName(body.startLocation as string)?.name;
  const target = wpByName(body.targetLocation as string)?.name;
  return { title, start, target, priority: Number(body.priority ?? 0), scheduledAt: (body.scheduledAt as string | null) ?? null };
}

// ---------------------------------------------------------------
// 設定変更の申請（backend/src/controllers/changeRequestController.ts と同じ決まり）
// ---------------------------------------------------------------
type DemoReview = { reviewerName: string; decision: 'APPROVE' | 'REJECT'; comment: string | null; createdAt: string };
type DemoReq = {
  id: string;
  settingKey: string;
  settingLabel: string;
  rank: number;
  currentValue: string;
  requestedValue: string;
  reason: string;
  effect: string | null;
  safetyRule: string | null;
  pledgedAt: string | null;
  status: ReqStatus;
  direct: boolean;
  requestedByName: string;
  appliedValue: string | null;
  appliedByName: string | null;
  signature: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
  reviews: DemoReview[];
};

// ログイン中の人（store.ts の startSession が知らせる）
let demoUser = { name: '', role: 'VIEWER' };
export function setDemoUser(name: string, role: string) {
  demoUser = { name, role };
}

let values: Record<string, string> = {};
let requests: DemoReq[] = [];
let reqSeq = 1;
const OTHER_ADMINS = ['suzuki（デモ）', 'takahashi（デモ）']; // 【仮】承認を試すための、ほかの管理者

const allValues = (): Record<string, string> => ({ ...values, battWarn: String(ops.battWarn), battMin: String(ops.battMin) });
const reqChanged = () => fire('change-requests:changed');
const settingsChanged = () => fire('settings:changed', { ops, values: allValues() });

function makeReq(key: string, value: string, by: string, d: { reason: string; effect?: string; safetyRule?: string }, at = Date.now()): DemoReq {
  const item = settingItem(key)!;
  return {
    id: `req-${String(reqSeq++).padStart(3, '0')}`,
    settingKey: key,
    settingLabel: item.label,
    rank: item.rank,
    currentValue: allValues()[key],
    requestedValue: value,
    reason: d.reason,
    effect: d.effect ?? null,
    safetyRule: d.safetyRule ?? null,
    pledgedAt: item.rank === 3 ? iso(at) : null,
    status: 'PENDING',
    direct: false,
    requestedByName: by,
    appliedValue: null,
    appliedByName: null,
    signature: null,
    appliedAt: null,
    createdAt: iso(at),
    updatedAt: iso(at),
    reviews: [],
  };
}

// 最初の状態：オペレーターからの申請が2件（L2 と L3）
function resetRequests() {
  reqSeq = 1;
  values = Object.fromEntries(SETTING_ITEMS.map((i) => [i.key, i.def]));
  const t = Date.now();
  requests = [
    makeReq('maxSpeed', '6', 'sato', { reason: '直線の広い通路での搬送に時間がかかり、1日の搬送回数が目標に届かないため。', effect: '1回あたりの搬送時間が短くなり、1日の搬送回数を増やせる見込み。', safetyRule: '入荷口付近は従来の速度を維持し、変更後1週間は監視担当を置く。' }, t - 20 * 60_000),
    makeReq('battWarn', '35', 'sato', { reason: '警告が出てから充電に戻るまでの時間が足りず、走行中に電池が切れる車両があるため。', effect: '警告が早く出るため、充電に戻る余裕ができ、電池切れによる停止が減る見込み。' }, t - 45 * 60_000),
  ];
}

// 値の確かめ。だめならエラーの文
function checkValue(key: string, raw: string, sameOk = false): string | null {
  const item = settingItem(key);
  if (!item || item.rank > 3) return 'この項目は申請できません';
  const err = valueError(item, raw, sameOk ? '\u0000' : allValues()[key]);
  if (err) return err;
  if (key === 'battWarn' || key === 'battMin') {
    const n = Number(raw);
    const warn = key === 'battWarn' ? n : ops.battWarn;
    const min = key === 'battMin' ? n : ops.battMin;
    if (min >= warn) return '「割り当てない残量」は「警告する残量」より小さくしてください';
  }
  return null;
}

function writeValue(key: string, v: string) {
  if (key === 'battWarn') ops = { ...ops, battWarn: Number(v) };
  else if (key === 'battMin') ops = { ...ops, battMin: Number(v) };
  else values[key] = v;
}

const hasOpen = (key: string) => requests.some((r) => r.settingKey === key && (r.status === 'PENDING' || r.status === 'APPROVED'));
const isAdmin = () => demoUser.role === 'ADMIN';
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function createRequest(body: Record<string, unknown>): Result {
  if (demoUser.role === 'VIEWER') return fail(403, 'この操作の権限がありません');
  const key = str(body.key);
  const item = settingItem(key);
  if (!item) return fail(400, 'この項目は申請できません');
  const err = checkValue(key, str(body.value));
  if (err) return fail(400, err);
  if (!str(body.reason)) return fail(400, '理由を入力してください');
  if (item.rank >= 2 && !str(body.effect)) return fail(400, 'それがもたらす効果を入力してください');
  if (item.rank === 3 && !str(body.safetyRule)) return fail(400, '安全に関するルール案を入力してください');
  if (item.rank === 3 && body.pledged !== true) return fail(400, '誓約の3項目すべてに同意してください');
  if (hasOpen(key)) return fail(409, 'この項目には、処理中の申請がすでにあります');
  const r = makeReq(key, str(body.value), demoUser.name, { reason: str(body.reason), effect: str(body.effect) || undefined, safetyRule: str(body.safetyRule) || undefined });
  requests.unshift(r);
  reqChanged();
  return ok(r, 201);
}

function addReview(r: DemoReq, name: string, decision: 'APPROVE' | 'REJECT', comment: string) {
  r.reviews.push({ reviewerName: name, decision, comment: comment || null, createdAt: iso() });
  const approvals = r.reviews.filter((v) => v.decision === 'APPROVE').length;
  r.status = decision === 'REJECT' ? 'REJECTED' : approvals >= needApprovals(r.rank) ? 'APPROVED' : 'PENDING';
  r.updatedAt = iso();
  reqChanged();
}

function reviewRequest(r: DemoReq, body: Record<string, unknown>): Result {
  if (!isAdmin()) return fail(403, 'この操作の権限がありません');
  const decision = body.decision === 'APPROVE' || body.decision === 'REJECT' ? body.decision : null;
  const comment = str(body.comment);
  if (!decision) return fail(400, '承認か不承認かを指定してください');
  if (decision === 'REJECT' && !comment) return fail(400, '不承認の理由を入力してください');
  if (r.status !== 'PENDING') return fail(409, 'この申請は承認待ちではありません');
  if (r.requestedByName === demoUser.name) return fail(403, '自分の申請は承認・不承認できません');
  if (r.reviews.some((v) => v.reviewerName === demoUser.name)) return fail(409, 'この申請にはすでに回答しています');
  addReview(r, demoUser.name, decision, comment);
  return ok(r);
}

// 【仮】ほかの管理者として承認する
function demoApprove(r: DemoReq): Result {
  if (!isAdmin()) return fail(403, 'この操作の権限がありません');
  if (r.status !== 'PENDING') return fail(409, 'この申請は承認待ちではありません');
  const name = OTHER_ADMINS.find((n) => n !== r.requestedByName && !r.reviews.some((v) => v.reviewerName === n));
  if (!name) return fail(409, 'デモで承認できる管理者がもういません');
  addReview(r, name, 'APPROVE', '');
  return ok(r);
}

function withdrawRequest(r: DemoReq): Result {
  if (r.requestedByName !== demoUser.name) return fail(403, '自分の申請だけ取り下げられます');
  if (r.status !== 'PENDING') return fail(409, '承認待ちの申請だけ取り下げられます');
  r.status = 'WITHDRAWN';
  r.updatedAt = iso();
  reqChanged();
  return ok(r);
}

function applyRequest(r: DemoReq, body: Record<string, unknown>): Result {
  if (!isAdmin()) return fail(403, 'この操作の権限がありません');
  if (str(body.signature) !== demoUser.name) return fail(400, 'サインには、あなたのユーザー名を入力してください');
  if (r.status !== 'APPROVED') return fail(409, '承認がそろった申請だけ変更できます');
  if (!r.reviews.some((v) => v.reviewerName === demoUser.name && v.decision === 'APPROVE')) return fail(403, 'この申請を承認した管理者だけが変更できます');
  const err = checkValue(r.settingKey, r.requestedValue, true);
  if (err) return fail(409, `${err}（申請のあとに条件が変わりました）`);
  writeValue(r.settingKey, r.requestedValue);
  Object.assign(r, { status: 'APPLIED', appliedValue: r.requestedValue, appliedByName: demoUser.name, signature: demoUser.name, appliedAt: iso(), updatedAt: iso() });
  settingsChanged();
  reqChanged();
  return ok(r);
}

function directChange(body: Record<string, unknown>): Result {
  if (!isAdmin()) return fail(403, 'この操作の権限がありません');
  const key = str(body.key);
  const item = settingItem(key);
  const value = str(body.value);
  if (!item) return fail(400, 'この項目は変更できません');
  if (item.rank >= 3) return fail(403, 'L3 の項目は、管理者でも申請と2人の承認が必要です');
  if (str(body.signature) !== demoUser.name) return fail(400, 'サインには、あなたのユーザー名を入力してください');
  const err = checkValue(key, value);
  if (err) return fail(400, err);
  if (hasOpen(key)) return fail(409, 'この項目には処理中の申請があります。先に申請を処理してください');
  const r = makeReq(key, value, demoUser.name, { reason: str(body.reason) || '管理者による直接の変更' });
  writeValue(key, value);
  Object.assign(r, { status: 'APPLIED', direct: true, appliedValue: value, appliedByName: demoUser.name, signature: demoUser.name, appliedAt: iso() });
  requests.unshift(r);
  settingsChanged();
  reqChanged();
  return ok(r, 201);
}

function requestRoute(key: string, id: string, body: Record<string, unknown>): Result | null {
  if (key === 'GET /change-requests') return ok(isAdmin() ? requests : requests.filter((r) => r.requestedByName === demoUser.name));
  if (key === 'POST /change-requests') return createRequest(body);
  if (key === 'POST /settings/:id') return id === 'direct' ? directChange(body) : null;
  if (!key.startsWith('POST /change-requests/:id/')) return null;
  const r = requests.find((x) => x.id === id);
  if (!r) return fail(404, '申請が見つかりません');
  switch (key.slice('POST /change-requests/:id/'.length)) {
    case 'review':
      return reviewRequest(r, body);
    case 'withdraw':
      return withdrawRequest(r);
    case 'apply':
      return applyRequest(r, body);
    case 'demo-approve':
      return demoApprove(r);
    default:
      return null;
  }
}

function route(method: string, path: string, params: Record<string, unknown>, body: Record<string, unknown>): Result {
  const seg = path.split('/').filter(Boolean).map(decodeURIComponent);
  const [res, id, sub] = seg;
  const key = `${method} /${res}${id ? (id === 'assign' ? '/assign' : '/:id') : ''}${sub ? `/${sub}` : ''}`;
  const req = requestRoute(key, id, body);
  if (req) return req;

  switch (key) {
    case 'GET /vehicles':
      return ok(vehicles.map(vehicleJson));
    case 'GET /vehicles/:id': {
      const v = need(id);
      return v ? ok(vehicleJson(v)) : fail(404, '車両が見つかりません');
    }
    case 'POST /vehicles': {
      const newId = typeof body.id === 'string' ? body.id.trim().toUpperCase() : '';
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!/^AGV-\d{2}$/.test(newId)) return fail(400, '車両IDは「AGV-数字2桁」の形にしてください（例: AGV-05）');
      if (!name) return fail(400, '表示名を入力してください');
      if (need(newId)) return fail(409, 'その車両IDはすでに登録されています');
      const v = makeVehicle(newId, name, 'Home', 'OFFLINE', 100);
      vehicles.push(v);
      fire('vehicles:changed');
      return ok(vehicleJson(v), 201);
    }
    case 'PATCH /vehicles/:id': {
      const v = need(id);
      if (!v) return fail(404, '車両が見つかりません');
      v.name = String(body.name ?? v.name).trim() || v.name;
      fire('vehicle:update', { id: v.id, name: v.name });
      return ok(vehicleJson(v));
    }
    case 'DELETE /vehicles/:id': {
      const v = need(id);
      if (!v) return fail(404, '車両が見つかりません');
      if (v.taskId) return fail(409, '割り当て済み・実行中のタスクがあるため削除できません。先にタスクを中止してください');
      vehicles = vehicles.filter((x) => x !== v);
      logs = logs.filter((l) => l.vehicleId !== v.id);
      fire('vehicles:changed');
      return ok({ ok: true });
    }
    case 'POST /vehicles/:id/test-online': {
      const v = need(id);
      if (!v) return fail(404, '車両が見つかりません');
      if (v.status === 'ERROR') return fail(409, '異常中の車両は切り替えられません。先に緊急状態を解除してください');
      if (body.online) {
        if (v.status === 'OFFLINE') v.status = 'IDLE';
      } else {
        clearVehicleTask(v);
        v.status = 'OFFLINE';
      }
      addLog(v.id, 'INFO', `【テスト】手動で${body.online ? 'オンライン' : 'オフライン'}にしました`);
      fire('vehicle:update', { id: v.id, status: v.status });
      return ok(vehicleJson(v));
    }
    case 'GET /tasks':
      return ok(tasks);
    case 'GET /tasks/:id': {
      const t = tasks.find((x) => x.id === id);
      return t ? ok(t) : fail(404, 'タスクが見つかりません');
    }
    case 'POST /tasks': {
      const d = readTask(body);
      if (!d.title || !d.start || !d.target) return fail(400, 'タイトル・出発地・目的地を入力してください（地点は一覧にあるものだけ使えます）');
      const t = makeTask(d.title, d.start, d.target, d.priority);
      t.scheduledAt = d.scheduledAt;
      t.createdByUser = { username: 'demo' };
      tasks.unshift(t);
      fire('tasks:changed');
      return ok(t, 201);
    }
    case 'POST /tasks/assign':
      return assignTask(body);
    case 'PATCH /tasks/:id': {
      const t = tasks.find((x) => x.id === id);
      if (!t) return fail(404, 'タスクが見つかりません');
      if (t.status !== 'PENDING') return fail(409, '配車済みのタスクは内容を編集できません');
      const d = readTask(body);
      if (!d.title || !d.start || !d.target) return fail(400, 'タイトル・出発地・目的地を入力してください（地点は一覧にあるものだけ使えます）');
      Object.assign(t, { title: d.title, startLocation: d.start, targetLocation: d.target, priority: d.priority, scheduledAt: d.scheduledAt });
      fire('tasks:changed');
      return ok(t);
    }
    case 'DELETE /tasks/:id': {
      const t = tasks.find((x) => x.id === id);
      if (!t) return fail(404, 'タスクが見つかりません');
      if (!['PENDING', 'ASSIGNED', 'IN_PROGRESS'].includes(t.status)) return fail(409, '既に完了・失敗・キャンセル済みのタスクです');
      const v = vehicles.find((x) => x.id === t.assignedVehicleId && x.taskId === t.id);
      setTaskStatus(t, 'CANCELLED', v ? 'タスクを中止しました' : 'タスクを取り消しました');
      if (v) {
        clearVehicleTask(v);
        addLog(v.id, 'WARN', `${t.id} を中止しました`);
        sendUpdate(v);
      }
      fire('tasks:changed');
      return ok({ ok: true });
    }
    case 'GET /logs':
      return getLogs(params);
    case 'GET /settings':
      return ok({ ops, values: allValues() });
    default:
      return fail(404, `デモでは未対応のAPIです: ${method} ${path}`);
  }
}

// axios の adapter として使う。実サーバーには送らず、ここで応答を作る
export async function demoAdapter(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  let body: Record<string, unknown> = {};
  if (typeof config.data === 'string') {
    try {
      body = JSON.parse(config.data) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }
  const r = route((config.method ?? 'get').toUpperCase(), config.url ?? '', (config.params ?? {}) as Record<string, unknown>, body);
  // 取得元のオブジェクトを画面側と共有しないよう、コピーして返す
  const response: AxiosResponse = { data: JSON.parse(JSON.stringify(r.data)), status: r.status, statusText: String(r.status), headers: r.headers ?? {}, config };
  if (r.status >= 400) throw new AxiosError(`デモ: ${r.status}`, AxiosError.ERR_BAD_REQUEST, config, null, response);
  return response;
}
