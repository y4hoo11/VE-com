// モックの状態・操作・シミュレーション。
// 本番では、ここが「API 呼び出し」と「Socket.IO の受信」に置き換わる。
import { useSyncExternalStore } from 'react';
import {
  ERR,
  isFree,
  makeRoute,
  newVehicle,
  pathLen,
  wpByName,
  WAYPOINTS,
  initialData,
  type Level,
  type Pt,
  type Role,
  type Task,
  type TStatus,
  type Vehicle,
  type VStatus,
} from './data';

// ---------------------------------------------------------------
// 型
// ---------------------------------------------------------------
export type DrawerState = { type: 'vehicle' | 'task' | 'log'; id: string } | null;

export type ModalBody =
  | {
      kind: 'confirm';
      title: string;
      body: string;
      detail?: string[];
      ok: string;
      danger?: boolean;
      check?: string; // チェックを入れないと OK を押せない
      onOk: () => void;
    }
  | { kind: 'taskForm'; mode: 'create' | 'edit'; taskId?: string }
  | { kind: 'assign'; taskId: string; fromCreate?: boolean }
  | { kind: 'password' }
  | { kind: 'user'; userId?: string }
  | { kind: 'vehicle'; vehicleId?: string };
export type ModalState = (ModalBody & { openedAt: number }) | null;

export type PopoverState = {
  kind: 'conn' | 'bell' | 'user' | 'veh' | 'wp';
  x: number;
  y: number;
  right?: boolean;
  id?: string;
} | null;

export type MapMode = { type: 'goto' | 'pose'; vid: string; p?: Pt; cursor?: Pt } | null;
export type Toast = { id: number; msg: string; type: 'info' | 'ok' | 'warn' | 'error' };

// ---------------------------------------------------------------
// 状態
// ---------------------------------------------------------------
const init = initialData();

export const S = {
  loggedIn: false,
  user: { name: 'matsukawa', role: 'OPERATOR' as Role },
  mqtt: true,
  ...init,
  toasts: [] as Toast[],
  drawer: null as DrawerState,
  modal: null as ModalState,
  popover: null as PopoverState,
  mapMode: null as MapMode,
  view: { grid: false, path: true, labels: true },
  theme: 'light' as 'light' | 'dark',
  sound: true,
  ops: { battWarn: 30, battMin: 20, maxSpeed: 0.3, obstacle: 0.45 },
  seq: { task: 1010, log: 1000, note: 100, toast: 1, user: 100 },
};

let version = 0;
const listeners = new Set<() => void>();
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};
export function emit() {
  version++;
  listeners.forEach((f) => f());
}
export function useStore() {
  useSyncExternalStore(subscribe, () => version);
  return S;
}

// ---------------------------------------------------------------
// 小物
// ---------------------------------------------------------------
export const now = () => Date.now();
export const veh = (id: string | null | undefined) => S.vehicles.find((v) => v.id === id);
export const task = (id: string | null | undefined) => S.tasks.find((t) => t.id === id);
export const canOperate = () => S.user.role !== 'VIEWER';
export const isAdmin = () => S.user.role === 'ADMIN';
export const nav = (path: string) => {
  window.location.hash = '#' + path;
};
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const who = () => `操作: ${S.user.name}`;

export function toast(msg: string, type: Toast['type'] = 'info') {
  const id = S.seq.toast++;
  S.toasts.push({ id, msg, type });
  emit();
  setTimeout(() => {
    S.toasts = S.toasts.filter((t) => t.id !== id);
    emit();
  }, 4000);
}

export function addLog(vid: string | null, level: Level, message: string, details?: Record<string, unknown>) {
  S.logs.unshift({ id: S.seq.log++, at: now(), vid, level, message, details });
  if (S.logs.length > 500) S.logs.length = 500;
}

function hist(t: Task, status: TStatus, note: string) {
  t.history.push({ at: now(), status, note });
}

// ---------------------------------------------------------------
// 画面の開け閉め
// ---------------------------------------------------------------
export function openVehicle(id: string) {
  S.drawer = { type: 'vehicle', id };
  S.popover = null;
  emit();
}
export function openTask(id: string) {
  S.drawer = { type: 'task', id };
  S.popover = null;
  emit();
}
export function openLog(id: number) {
  S.drawer = { type: 'log', id: String(id) };
  emit();
}
export function closeDrawer() {
  S.drawer = null;
  emit();
}
export function openModal(m: ModalBody) {
  S.modal = { ...m, openedAt: now() };
  S.popover = null;
  emit();
}
export function closeModal() {
  S.modal = null;
  emit();
}
export function togglePop(p: NonNullable<PopoverState>) {
  const cur = S.popover;
  S.popover = cur && cur.kind === p.kind && cur.id === p.id ? null : p;
  emit();
}
export function closePop() {
  if (!S.popover) return;
  S.popover = null;
  emit();
}

// ---------------------------------------------------------------
// 安全（緊急停止・解除）
// ---------------------------------------------------------------
export function raiseError(v: Vehicle, code: string, reason: string, latched: boolean, source: string, autoMs?: number) {
  if (v.status !== 'ERROR') v.prevStatus = v.status;
  v.status = 'ERROR';
  v.speed = 0;
  v.err = { code, reason, latched, source, at: now(), clearAt: autoMs ? now() + autoMs : undefined };
  addLog(v.id, 'ERROR', `${ERR[code] ?? code}: ${reason}`, { code, source });
  S.notes.unshift({ id: S.seq.note++, vid: v.id, text: `${v.name}: ${ERR[code] ?? code}`, at: now(), read: false });
}

function mqttWarn() {
  if (!S.mqtt) toast('MQTTブローカーに接続されていないため、命令はまだ車両に届いていません', 'error');
}

export function estop(id: string) {
  const v = veh(id);
  if (!v || !v.online || v.status === 'ERROR') return;
  raiseError(v, 'WEB_ESTOP', `Webから緊急停止しました（${who()}）`, true, 'web');
  toast(`${v.name} に緊急停止を送信しました`, 'warn');
  mqttWarn();
  emit();
}

export function stopAll() {
  const targets = S.vehicles.filter((v) => v.online && v.status !== 'ERROR');
  targets.forEach((v) => raiseError(v, 'WEB_ESTOP', `全車停止（${who()}）`, true, 'web'));
  addLog(null, 'ERROR', `全車停止を送信しました（agv/broadcast/stop, ${who()}）`);
  toast(targets.length ? `全車停止を送信しました（${targets.length}台）` : '止める対象の車両がありません', 'warn');
  mqttWarn();
  emit();
}

export function askClear(id: string) {
  const v = veh(id);
  if (!v?.err) return;
  openModal({
    kind: 'confirm',
    title: `${v.name} の緊急状態を解除`,
    body: `${ERR[v.err.code] ?? v.err.code}：${v.err.reason}`,
    detail: [
      `原因コード: ${v.err.code}（${v.err.source}）`,
      v.taskId ? '解除後、実行中のタスクは「一時停止」のまま残ります。安全を確かめてから「再開」を押してください。' : '解除後は待機状態に戻ります。',
    ],
    check: '車両の周りに人や障害物がないことを確認しました',
    ok: '解除する',
    danger: true,
    onOk: () => clearEmergency(id),
  });
}

export function clearEmergency(id: string) {
  const v = veh(id);
  if (!v) return;
  v.err = null;
  if (v.taskId || v.mode === 'GOTO') {
    v.status = 'RUNNING';
    v.paused = true;
  } else {
    v.status = v.prevStatus === 'CHARGING' ? 'CHARGING' : 'IDLE';
  }
  addLog(v.id, 'INFO', `緊急状態を解除しました（CLEAR_EMERGENCY, ${who()}）`);
  toast(v.paused ? `${v.name} を解除しました。一時停止中です（「再開」で続けます）` : `${v.name} を解除しました`, 'ok');
  mqttWarn();
  emit();
}

// ---------------------------------------------------------------
// 運行操作
// ---------------------------------------------------------------
export function pause(id: string) {
  const v = veh(id);
  if (!v) return;
  v.paused = true;
  addLog(v.id, 'INFO', `一時停止しました（PAUSE, ${who()}）`);
  toast(`${v.name} を一時停止しました`);
  emit();
}
export function resume(id: string) {
  const v = veh(id);
  if (!v) return;
  v.paused = false;
  addLog(v.id, 'INFO', `再開しました（RESUME, ${who()}）`);
  toast(`${v.name} を再開しました`, 'ok');
  emit();
}
export function confirmLoad(id: string) {
  const v = veh(id);
  if (!v || v.wait <= 0) return;
  v.wait = 0.001;
  addLog(v.id, 'INFO', `${v.phase === 'LOADING' ? '荷積み' : '荷降ろし'}の完了を送信しました（CONFIRM, ${who()}）`);
  emit();
}

export function doGoto(id: string, target: { name?: string; x: number; y: number }) {
  const v = veh(id);
  if (!v) return;
  v.route = makeRoute(v, target);
  v.routeTotal = pathLen(v.route) || 1;
  v.mode = 'GOTO';
  v.goal = target.name ?? `${target.x.toFixed(1)}, ${target.y.toFixed(1)}`;
  v.status = 'RUNNING';
  v.paused = false;
  addLog(v.id, 'INFO', `${v.goal} への移動を指示しました（GOTO, ${who()}）`);
  toast(`${v.name} を ${v.goal} へ移動させます`, 'ok');
  mqttWarn();
  emit();
}

export function askHome(id: string) {
  const v = veh(id);
  const h = WAYPOINTS.find((w) => w.charger)!;
  if (!v) return;
  openModal({
    kind: 'confirm',
    title: 'ホームへ戻す',
    body: `${v.name} を ${h.name}（${h.label}）へ戻します。`,
    ok: '戻す',
    onOk: () => doGoto(id, h),
  });
}

// --- 地図の操作モード（移動先の指定・現在地の設定）---
export function startMapMode(type: 'goto' | 'pose', vid: string) {
  const h = window.location.hash;
  if (!(h === '' || h === '#/' || h.startsWith('#/vehicles/'))) nav('/');
  S.mapMode = { type, vid };
  S.popover = null;
  emit();
}
export function cancelMapMode() {
  S.mapMode = null;
  emit();
}
export function setMapCursor(p: Pt) {
  if (!S.mapMode) return;
  S.mapMode.cursor = p;
  emit();
}
export function nearestWp(p: Pt, within = 0.7) {
  let best: (typeof WAYPOINTS)[number] | undefined;
  let bd = within;
  WAYPOINTS.forEach((w) => {
    const d = Math.hypot(w.x - p.x, w.y - p.y);
    if (d < bd) {
      bd = d;
      best = w;
    }
  });
  return best;
}

export function askGoto(vid: string, target: { name?: string; label?: string; x: number; y: number }) {
  const v = veh(vid);
  if (!v) return;
  const label = target.name ? `${target.name}（${target.label}）` : `座標 (${target.x.toFixed(1)}, ${target.y.toFixed(1)})`;
  S.mapMode = null;
  openModal({
    kind: 'confirm',
    title: '地点へ移動',
    body: `${v.name} を ${label} へ移動させます。`,
    detail: ['経路は車両側（Nav2）が計画します。地図に予定の経路が表示されます。'],
    ok: '移動させる',
    onOk: () => doGoto(vid, target),
  });
}

export function mapModeClick(p: Pt) {
  const mm = S.mapMode;
  if (!mm) return;
  if (mm.type === 'goto') {
    const w = nearestWp(p);
    if (w) return askGoto(mm.vid, w);
    if (!isFree(p)) return toast('そこは棚・壁の上なので指定できません', 'warn');
    return askGoto(mm.vid, { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
  }
  // 現在地の設定: 1回目 = 位置、2回目 = 向き
  if (!mm.p) {
    if (!isFree(p)) return toast('そこは棚・壁の上なので指定できません', 'warn');
    mm.p = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
    emit();
    return;
  }
  const pos = mm.p;
  const theta = Math.atan2(p.y - pos.y, p.x - pos.x);
  const v = veh(mm.vid)!;
  S.mapMode = null;
  openModal({
    kind: 'confirm',
    title: '現在地を設定',
    body: `${v.name} の現在地を x ${pos.x.toFixed(1)} / y ${pos.y.toFixed(1)} m、向き ${Math.round((theta * 180) / Math.PI)}° に設定します。`,
    detail: ['自己位置が分からなくなったとき（LOCALIZATION_LOST）や、車両を手で運んだときに使います。'],
    ok: '設定する',
    onOk: () => {
      v.x = pos.x;
      v.y = pos.y;
      v.theta = theta;
      v.loc = 0.95;
      if (v.err?.code === 'LOCALIZATION_LOST') {
        v.err = null;
        v.status = v.prevStatus;
      }
      addLog(v.id, 'INFO', `現在地を設定しました（SET_POSE x=${pos.x} y=${pos.y}, ${who()}）`);
      toast(`${v.name} の現在地を設定しました`, 'ok');
      emit();
    },
  });
}

// ---------------------------------------------------------------
// タスク
// ---------------------------------------------------------------
export function createTask(d: { title: string; start: string; target: string; priority: number; scheduledAt: number | null }) {
  const t: Task = {
    id: `T-${S.seq.task++}`,
    ...d,
    status: 'PENDING',
    vehicleId: null,
    createdBy: S.user.name,
    createdAt: now(),
    startedAt: null,
    completedAt: null,
    progress: 0,
    history: [{ at: now(), status: 'PENDING', note: `タスクを作成しました（${who()}）` }],
  };
  S.tasks.push(t);
  addLog(null, 'INFO', `タスク [${t.title}] を作成しました（${who()}）`);
  emit();
  return t;
}

export function updateTask(id: string, d: { title: string; start: string; target: string; priority: number; scheduledAt: number | null }) {
  const t = task(id);
  if (!t) return;
  Object.assign(t, d);
  hist(t, t.status, `内容を変更しました（${who()}）`);
  toast(`${t.id} を保存しました`, 'ok');
  emit();
}

export function startTask(tid: string, vid: string) {
  const t = task(tid);
  const v = veh(vid);
  if (!t || !v) return;
  t.status = 'ASSIGNED';
  t.vehicleId = v.id;
  hist(t, 'ASSIGNED', `車両 [${v.id}] に割り当てました（${who()}）`);
  const s = wpByName(t.start)!;
  v.taskId = t.id;
  v.phase = 'TO_START';
  v.mode = 'TASK';
  v.status = 'RUNNING';
  v.paused = false;
  v.wait = 0;
  v.goal = t.start;
  v.route = makeRoute(v, s);
  v.routeTotal = pathLen(v.route) || 1;
  addLog(v.id, 'INFO', `${v.id} にタスク [${t.title}] を割り当てました（TASK_ASSIGN）`);
  toast(`${t.id} を ${v.name} に割り当てました`, 'ok');
  mqttWarn();
  emit();
}

export function askCancel(tid: string) {
  const t = task(tid);
  if (!t) return;
  const running = t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS';
  const v = veh(t.vehicleId);
  openModal({
    kind: 'confirm',
    title: running ? 'タスクの中止' : 'タスクの取り消し',
    body: running
      ? `${t.id}「${t.title}」を中止します。${v?.name ?? '車両'}はその場で止まります。`
      : `${t.id}「${t.title}」を取り消します。`,
    detail: running ? ['荷物を積んでいる場合は、車両のところまで行って荷物を確認してください。'] : undefined,
    ok: running ? '中止する' : '取り消す',
    danger: true,
    onOk: () => cancelTask(tid),
  });
}

export function cancelTask(tid: string) {
  const t = task(tid);
  if (!t) return;
  const v = veh(t.vehicleId);
  if (v && v.taskId === t.id) {
    v.taskId = null;
    v.phase = null;
    v.route = [];
    v.wait = 0;
    v.paused = false;
    v.goal = null;
    v.mode = 'IDLE';
    if (v.status === 'ERROR') v.prevStatus = 'IDLE';
    else v.status = 'IDLE';
    addLog(v.id, 'WARN', `タスク [${t.title}] を中止しました（CANCEL_TASK, ${who()}）`);
  }
  t.status = 'CANCELLED';
  t.completedAt = now();
  hist(t, 'CANCELLED', `${v ? '中止' : '取り消し'}しました（${who()}）`);
  toast(`${t.id} を${v ? '中止' : '取り消'}しました`, 'warn');
  emit();
}

// 割り当て候補（モーダルで使う）
export function candidates(tid: string) {
  const t = task(tid)!;
  const s = wpByName(t.start)!;
  const list = S.vehicles.map((v) => {
    let ng: string | null = null;
    if (!v.online) ng = 'オフライン';
    else if (v.status === 'ERROR') ng = '異常中';
    else if (v.taskId) ng = '別のタスクを実行中';
    else if (v.mode === 'GOTO') ng = '移動中';
    else if ((v.battery ?? 0) < S.ops.battMin) ng = `電池残量不足（${S.ops.battMin}%未満）`;
    const dist = Math.abs(v.x - s.x) + Math.abs(v.y - s.y);
    return { v, ng, dist };
  });
  const rec = list.filter((c) => !c.ng).sort((a, b) => a.dist - b.dist)[0]?.v.id ?? null;
  return { list, rec };
}

// ---------------------------------------------------------------
// 設定（ユーザー・車両）
// ---------------------------------------------------------------
export function saveUser(d: { id?: string; name: string; email: string; role: Role }) {
  if (d.id) {
    const u = S.users.find((x) => x.id === d.id)!;
    Object.assign(u, d);
    toast(`${u.name} を保存しました`, 'ok');
  } else {
    S.users.push({ ...d, id: `u${S.seq.user++}`, created: new Date().toISOString().slice(0, 10) });
    toast(`${d.name} を追加しました`, 'ok');
  }
  emit();
}
export function askDeleteUser(id: string) {
  const u = S.users.find((x) => x.id === id);
  if (!u) return;
  openModal({
    kind: 'confirm',
    title: 'ユーザーの削除',
    body: `${u.name}（${u.email}）を削除します。`,
    detail: ['このユーザーが作ったタスクは残ります（作成者は空になります）。'],
    ok: '削除する',
    danger: true,
    onOk: () => {
      S.users = S.users.filter((x) => x.id !== id);
      toast(`${u.name} を削除しました`, 'warn');
      emit();
    },
  });
}
export function saveVehicle(d: { id: string; name: string; camera: string }, isNew: boolean) {
  if (isNew) {
    S.vehicles.push(newVehicle(d.id, d.name, d.camera));
    toast(`${d.name}（${d.id}）を登録しました。車両からデータが届くまで OFFLINE です`, 'ok');
  } else {
    const v = veh(d.id)!;
    v.name = d.name;
    v.camera = d.camera;
    toast(`${v.name} を保存しました`, 'ok');
  }
  emit();
}
export function askDeleteVehicle(id: string) {
  const v = veh(id);
  if (!v) return;
  openModal({
    kind: 'confirm',
    title: '車両の削除',
    body: `${v.name}（${v.id}）を削除します。`,
    detail: ['この車両のログも一緒に削除されます（DB の onDelete: Cascade）。', '割り当て中のタスクは未割当に戻ります。'],
    ok: '削除する',
    danger: true,
    onOk: () => {
      S.vehicles = S.vehicles.filter((x) => x.id !== id);
      S.logs = S.logs.filter((l) => l.vid !== id);
      S.tasks.forEach((t) => {
        if (t.vehicleId === id && (t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS')) {
          t.status = 'PENDING';
          t.vehicleId = null;
        }
      });
      if (S.drawer?.id === id) S.drawer = null;
      toast(`${v.name} を削除しました`, 'warn');
      emit();
    },
  });
}

// ---------------------------------------------------------------
// モック操作（画面左下のパネル）
// ---------------------------------------------------------------
export function demoBlock() {
  const v = S.vehicles.find((x) => x.online && x.status === 'RUNNING' && !x.paused);
  if (!v) return toast('走行中の車両がありません。タスクを割り当ててから試してください', 'info');
  raiseError(v, 'BLOCKED', '前方障害物で15秒停止中', false, 'lidar', 8000);
  emit();
}
export function demoLocLost() {
  const v = S.vehicles.find((x) => x.online && x.status !== 'ERROR');
  if (!v) return;
  v.loc = 0.32;
  raiseError(v, 'LOCALIZATION_LOST', '自己位置が分からなくなりました。マーカーが見える所へ動かすか、現在地を設定してください', false, 'pc1');
  emit();
}
export function demoToggleOnline(id: string) {
  const v = veh(id);
  if (!v) return;
  v.online = !v.online;
  if (v.online) {
    v.status = 'IDLE';
    v.battery = v.battery ?? 72;
    addLog(v.id, 'INFO', '車両からのデータを受信しました（オンライン）');
  } else {
    v.status = 'OFFLINE';
    addLog(v.id, 'ERROR', '車両からのデータが途切れました（OFFLINE）');
  }
  emit();
}
export function demoToggleMqtt() {
  S.mqtt = !S.mqtt;
  addLog(null, S.mqtt ? 'INFO' : 'ERROR', S.mqtt ? 'MQTTブローカーに再接続しました' : 'MQTTブローカーとの接続が切れました');
  emit();
}

// ---------------------------------------------------------------
// シミュレーション（10Hz）
// ---------------------------------------------------------------
const DT = 0.1;
const SPEED = 0.6; // モックでは実機（0.3 m/s）の2倍速で動かす
const WAIT = 5; // 荷積み・荷降ろしの秒数

function updProg(v: Vehicle) {
  const t = task(v.taskId);
  if (!t || !v.phase) return;
  const fr = clamp(1 - pathLen(v.route) / v.routeTotal, 0, 1);
  const w = clamp(1 - v.wait / WAIT, 0, 1);
  t.progress = { TO_START: 35 * fr, LOADING: 35 + 15 * w, TO_TARGET: 50 + 40 * fr, UNLOADING: 90 + 10 * w }[v.phase];
}

function arrived(v: Vehicle) {
  const t = task(v.taskId);
  v.speed = 0;
  if (t) {
    if (v.phase === 'TO_START') {
      v.phase = 'LOADING';
      v.wait = WAIT;
      hist(t, 'IN_PROGRESS', `[LOADING] ${t.start} で荷積み中`);
      addLog(v.id, 'INFO', `${t.title}: ${t.start} に到着、荷積み中`);
    } else if (v.phase === 'TO_TARGET') {
      v.phase = 'UNLOADING';
      v.wait = WAIT;
      hist(t, 'IN_PROGRESS', `[UNLOADING] ${t.target} で荷降ろし中`);
      addLog(v.id, 'INFO', `${t.title}: ${t.target} に到着、荷降ろし中`);
    }
  } else if (v.mode === 'GOTO') {
    const w = wpByName(v.goal);
    v.mode = 'IDLE';
    v.status = w?.charger ? 'CHARGING' : 'IDLE';
    addLog(v.id, 'INFO', `${v.goal} に到着しました`);
    v.goal = null;
    v.route = [];
  }
}

function phaseDone(v: Vehicle) {
  const t = task(v.taskId);
  if (!t) return;
  if (v.phase === 'LOADING') {
    const g = wpByName(t.target)!;
    v.phase = 'TO_TARGET';
    v.goal = t.target;
    v.route = makeRoute(v, g);
    v.routeTotal = pathLen(v.route) || 1;
    hist(t, 'IN_PROGRESS', `[TO_TARGET] ${t.target} へ移動中`);
  } else if (v.phase === 'UNLOADING') {
    t.status = 'COMPLETED';
    t.progress = 100;
    t.completedAt = now();
    hist(t, 'COMPLETED', `[UNLOADING] ${t.target} で荷降ろし完了`);
    addLog(v.id, 'INFO', `${t.title}: 完了しました`);
    toast(`${t.id}「${t.title}」が完了しました`, 'ok');
    Object.assign(v, { taskId: null, phase: null, goal: null, status: 'IDLE' as VStatus, mode: 'IDLE', route: [] });
  }
}

function stepVehicle(v: Vehicle) {
  if (!v.online) {
    v.status = 'OFFLINE';
    v.speed = 0;
    return;
  }
  v.lastHb = now();
  v.piTemp = clamp(v.piTemp + (Math.random() - 0.5) * 0.06, 44, 62);
  if (v.status !== 'ERROR') v.loc = clamp(v.loc + (Math.random() - 0.48) * 0.004, 0.75, 0.98);

  if (v.err) {
    v.speed = 0;
    if (v.err.clearAt && now() > v.err.clearAt) {
      const name = ERR[v.err.code] ?? v.err.code;
      v.err = null;
      v.status = v.prevStatus === 'ERROR' ? 'IDLE' : v.prevStatus;
      addLog(v.id, 'INFO', `原因がなくなったため自動で戻りました（${name}）`);
    }
    return;
  }
  if (v.paused) {
    v.speed = 0;
    return;
  }
  if (v.wait > 0) {
    v.speed = 0;
    v.wait -= DT;
    if (v.wait <= 0) {
      v.wait = 0;
      phaseDone(v);
    }
    updProg(v);
    return;
  }
  if (v.route.length > 1) {
    let step = SPEED * DT;
    while (step > 0 && v.route.length > 1) {
      const a = v.route[0];
      const b = v.route[1];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d <= step) {
        v.route.shift();
        step -= d;
      } else {
        const r = step / d;
        v.route[0] = { x: a.x + (b.x - a.x) * r, y: a.y + (b.y - a.y) * r };
        step = 0;
      }
    }
    const cur = v.route[0];
    const next = v.route[1];
    if (next) v.theta = Math.atan2(next.y - cur.y, next.x - cur.x);
    v.x = cur.x;
    v.y = cur.y;
    v.speed = 0.3;
    if (v.battery != null) v.battery = Math.max(0, v.battery - 0.004);
    const t = task(v.taskId);
    if (t && t.status === 'ASSIGNED') {
      t.status = 'IN_PROGRESS';
      t.startedAt = now();
      hist(t, 'IN_PROGRESS', `[TO_START] ${t.start} へ移動中`);
    }
    if (v.route.length <= 1) arrived(v);
    updProg(v);
    return;
  }
  v.speed = 0;
  if (v.status === 'CHARGING' && v.battery != null) v.battery = Math.min(100, v.battery + 0.02);
}

let started = false;
export function startSim() {
  if (started) return;
  started = true;
  setInterval(() => {
    // MQTT が切れている間は車両からのデータが届かない（＝画面の値が止まる）
    if (S.mqtt) S.vehicles.forEach(stepVehicle);
    emit();
  }, DT * 1000);
}
