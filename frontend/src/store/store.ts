// 画面全体の状態と操作。
// データはバックエンド（REST API と Socket.IO）から取り、画面はここを通して読み書きする。
// まだバックエンドに無い操作（一時停止・移動の指示・ユーザー登録など）は NOT_SUPPORTED で止める。
// 運行の設定（バッテリーのしきい値）はサーバーに保存し、全端末で共有する。
import { useSyncExternalStore } from 'react';
import { isAxiosError } from 'axios';
import { api } from '../services/api';
import { emitWithAck, socket } from '../services/socket';
import {
  ERR,
  LATCHED,
  wpByName,
  WAYPOINTS,
  type Hist,
  type Level,
  type Log,
  type Note,
  type Phase,
  type Pt,
  type Role,
  type Task,
  type TStatus,
  type User,
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

// バックエンドの形（GET /api/vehicles, /api/tasks, /api/logs）
interface ApiVehicle {
  id: string;
  name: string;
  status: VStatus;
  batteryLevel: number | null;
  currentX: number;
  currentY: number;
  currentTheta: number | null;
  currentMapId: string | null;
  lastHeartbeat: string | null;
}
interface ApiTask {
  id: string;
  title: string;
  status: TStatus;
  priority: number;
  assignedVehicleId: string | null;
  startLocation: string | null;
  targetLocation: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  createdByUser?: { username: string } | null;
  histories?: { status: TStatus; note: string | null; timestamp: string }[];
}
interface ApiLog {
  id: string;
  vehicleId: string | null;
  level: Level;
  message: string;
  details?: Record<string, unknown> | null;
  timestamp: string;
}
// Socket の vehicle:update（届いた項目だけ入っている）
interface VehicleUpdate {
  id: string;
  name?: string;
  status?: VStatus;
  batteryLevel?: number | null;
  currentX?: number | null;
  currentY?: number | null;
  currentTheta?: number | null;
  emergencyReason?: string | null;
  emergencyCode?: string | null;
  emergencySource?: string | null;
  telemetry?: {
    speed?: number;
    locQuality?: number;
    piTemp?: number;
    esp32?: boolean;
    lidarHz?: number;
    vbat?: number;
    phase?: string;
    goal?: string;
  };
}

// ---------------------------------------------------------------
// 状態
// ---------------------------------------------------------------
// 端末ごとに覚えておく表示の設定（ブラウザに保存）
const PREF_KEY = 'vecom_prefs';
type Prefs = { theme: 'light' | 'dark'; view: { grid: boolean; path: boolean; labels: boolean }; sound: boolean };
export type OpsSettings = { battWarn: number; battMin: number };
const loadPrefs = (): Partial<Prefs> => {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') as Partial<Prefs>;
  } catch {
    return {};
  }
};
const prefs = loadPrefs();

export const S = {
  user: { name: '', role: 'VIEWER' as Role },
  mqtt: true, // サーバー⇔MQTT（system:status で更新）
  server: false, // ブラウザ⇔サーバー（Socket.IO の接続）
  loaded: false,
  vehicles: [] as Vehicle[],
  tasks: [] as Task[],
  logs: [] as Log[],
  notes: [] as Note[],
  users: [] as User[], // ユーザー一覧のAPIが無いので、ログイン中の本人だけ
  toasts: [] as Toast[],
  drawer: null as DrawerState,
  modal: null as ModalState,
  popover: null as PopoverState,
  mapMode: null as MapMode,
  view: { grid: false, path: true, labels: true, ...prefs.view },
  theme: (prefs.theme ?? 'light') as 'light' | 'dark',
  sound: prefs.sound ?? true,
  // 運行の設定。battWarn・battMin はサーバー（GET /api/settings）から読む。maxSpeed・obstacle は表示だけ
  ops: { battWarn: 30, battMin: 20, maxSpeed: 0.3, obstacle: 0.45 },
  seq: { note: 1, toast: 1 },
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

// 表示の設定をブラウザに保存する
export function savePrefs() {
  try {
    const p: Prefs = { theme: S.theme, view: S.view, sound: S.sound };
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* 保存できない環境では何もしない */
  }
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
const ms = (s: string | null | undefined) => (s ? Date.parse(s) : null);

// まだバックエンドに無い機能
export const NOT_SUPPORTED = 'バックエンドに命令・APIがまだ無いため未対応です';
export function notSupported() {
  toast(NOT_SUPPORTED, 'warn');
}

export function toast(msg: string, type: Toast['type'] = 'info') {
  const id = S.seq.toast++;
  S.toasts.push({ id, msg, type });
  emit();
  setTimeout(() => {
    S.toasts = S.toasts.filter((t) => t.id !== id);
    emit();
  }, 4000);
}

// API のエラーから、画面に出す文言を取り出す
const errMsg = (e: unknown, fallback: string) =>
  (isAxiosError(e) && (e.response?.data as { error?: string; message?: string } | undefined)?.error) ||
  (isAxiosError(e) && (e.response?.data as { message?: string } | undefined)?.message) ||
  fallback;

// ---------------------------------------------------------------
// バックエンドの形 → 画面の形
// ---------------------------------------------------------------
const isActive = (s: TStatus) => s === 'ASSIGNED' || s === 'IN_PROGRESS';

function toTask(a: ApiTask, prev?: Task): Task {
  return {
    id: a.id,
    no: a.id.slice(0, 8),
    title: a.title,
    start: a.startLocation ?? '',
    target: a.targetLocation ?? '',
    priority: a.priority,
    status: a.status,
    vehicleId: a.assignedVehicleId,
    createdBy: a.createdByUser?.username ?? '—',
    createdAt: ms(a.createdAt) ?? 0,
    scheduledAt: ms(a.scheduledAt),
    startedAt: ms(a.startedAt),
    completedAt: ms(a.completedAt),
    progress: a.status === 'COMPLETED' ? 100 : (prev?.progress ?? null),
    history: prev?.history ?? [],
    historyLoaded: prev?.historyLoaded ?? false,
  };
}

function toLog(a: ApiLog): Log {
  return {
    id: Number(a.id),
    at: ms(a.timestamp) ?? now(),
    vid: a.vehicleId,
    level: a.level,
    message: a.message,
    details: a.details ?? undefined,
  };
}

function toVehicle(a: ApiVehicle, prev?: Vehicle): Vehicle {
  return {
    id: a.id,
    name: a.name || a.id,
    x: a.currentX,
    y: a.currentY,
    theta: a.currentTheta ?? 0,
    status: a.status,
    battery: a.batteryLevel,
    speed: prev?.speed ?? null,
    loc: prev?.loc ?? null,
    piTemp: prev?.piTemp ?? null,
    esp32: prev?.esp32 ?? null,
    lidarHz: prev?.lidarHz ?? null,
    vbat: prev?.vbat ?? null,
    online: a.status !== 'OFFLINE',
    paused: false,
    wait: 0,
    taskId: null,
    phase: prev?.phase ?? null,
    route: [],
    routeTotal: 1,
    goal: prev?.goal ?? null,
    mode: 'IDLE',
    err: prev?.status === 'ERROR' && a.status === 'ERROR' ? prev.err : null,
    prevStatus: a.status,
    camera: '', // カメラ映像のURLは、保存する仕組みができたら入れる
    lastHb: ms(a.lastHeartbeat) ?? 0,
  };
}

// 異常の中身を作る（届いた code / reason、無ければ最新の ERROR ログから）
function makeErr(v: Vehicle, reason?: string | null, code?: string | null, source?: string | null) {
  const log = S.logs.find((l) => l.vid === v.id && l.level === 'ERROR');
  const d = (log?.details ?? {}) as { code?: unknown; source?: unknown; reason?: unknown };
  const c = code || (typeof d.code === 'string' ? d.code : '') || 'UNKNOWN';
  v.err = {
    code: c,
    reason: reason || (typeof d.reason === 'string' ? d.reason : '') || log?.message || '異常が発生しました',
    latched: LATCHED.has(c) || !(c in ERR),
    source: source || (typeof d.source === 'string' ? d.source : '') || '—',
    at: log?.at ?? now(),
  };
}

// 車両と実行中タスクをつなぐ（vehicle.taskId・行き先・モード）
function relink() {
  S.vehicles.forEach((v) => {
    const t = S.tasks
      .filter((x) => x.vehicleId === v.id && isActive(x.status))
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    v.taskId = t?.id ?? null;
    v.mode = t ? 'TASK' : 'IDLE';
    if (t && !v.goal) v.goal = t.status === 'ASSIGNED' ? t.start : t.target;
    if (!t) v.phase = null;
    if (v.status === 'ERROR' && !v.err) makeErr(v);
    if (v.status !== 'ERROR') v.err = null;
  });
}

// ---------------------------------------------------------------
// 読み込み
// ---------------------------------------------------------------
async function loadVehicles() {
  const res = await api.get<ApiVehicle[]>('/vehicles');
  S.vehicles = res.data.map((a) => toVehicle(a, veh(a.id)));
}
async function loadTasks() {
  const res = await api.get<ApiTask[]>('/tasks', { params: { includeCancelled: true } });
  S.tasks = res.data.map((a) => toTask(a, task(a.id)));
}
async function loadLogs() {
  const res = await api.get<ApiLog[]>('/logs', { params: { limit: 200 } });
  S.logs = res.data.map(toLog);
}

async function loadSettings() {
  const res = await api.get<{ ops: OpsSettings }>('/settings');
  applyOps(res.data.ops);
}
function applyOps(o: Partial<OpsSettings> | undefined) {
  if (typeof o?.battWarn === 'number') S.ops.battWarn = o.battWarn;
  if (typeof o?.battMin === 'number') S.ops.battMin = o.battMin;
}

// ログ画面で取ったログ（S.logs に無い古いもの）も、ドロワーで開けるように覚えておく
const pagedLogs = new Map<number, Log>();
export function keepLogs(list: Log[]) {
  if (pagedLogs.size > 5000) pagedLogs.clear();
  list.forEach((l) => pagedLogs.set(l.id, l));
}
export const findLog = (id: number) => S.logs.find((x) => x.id === id) ?? pagedLogs.get(id);
export { toLog };
export type { ApiLog };

export async function loadTaskHistory(id: string) {
  try {
    const res = await api.get<ApiTask>(`/tasks/${id}`);
    const t = task(id);
    if (!t) return;
    t.history = (res.data.histories ?? []).map(
      (h): Hist => ({ at: ms(h.timestamp) ?? 0, status: h.status, note: h.note ?? '' }),
    );
    t.historyLoaded = true;
    emit();
  } catch (e) {
    console.error('タスクの履歴の取得に失敗しました:', e);
  }
}

async function reloadAll() {
  try {
    await Promise.all([loadVehicles(), loadTasks(), loadLogs(), loadSettings()]);
    relink();
    S.loaded = true;
    emit();
  } catch (e) {
    console.error('データの取得に失敗しました:', e);
    toast('サーバーからデータを取得できませんでした', 'error');
  }
}

async function reloadTasks() {
  try {
    await loadTasks();
    relink();
    emit();
    if (S.drawer?.type === 'task') loadTaskHistory(S.drawer.id);
  } catch (e) {
    console.error('タスクの取得に失敗しました:', e);
  }
}

// ---------------------------------------------------------------
// Socket.IO の受信（接続は AuthContext がログイン中だけ行う）
// ---------------------------------------------------------------
let listening = false;
function listen() {
  if (listening) return;
  listening = true;

  socket.on('connect', () => {
    S.server = true;
    reloadAll(); // 切断中の変化を取りこぼさないよう、つながるたびに取り直す
  });
  socket.on('disconnect', () => {
    S.server = false;
    emit();
  });

  socket.on('system:status', (st: { mqtt?: boolean }) => {
    if (typeof st?.mqtt === 'boolean' && st.mqtt !== S.mqtt) {
      S.mqtt = st.mqtt;
      emit();
    }
  });

  socket.on('vehicle:update', (u: VehicleUpdate) => {
    const v = veh(u.id);
    if (!v) {
      loadVehicles().then(() => {
        relink();
        emit();
      });
      return;
    }
    if (u.name !== undefined) v.name = u.name;
    if (u.batteryLevel !== undefined) v.battery = u.batteryLevel;
    if (u.currentX != null) v.x = u.currentX;
    if (u.currentY != null) v.y = u.currentY;
    if (u.currentTheta != null) v.theta = u.currentTheta;
    const tm = u.telemetry;
    if (tm) {
      if (tm.speed !== undefined) v.speed = tm.speed;
      if (tm.locQuality !== undefined) v.loc = tm.locQuality;
      if (tm.piTemp !== undefined) v.piTemp = tm.piTemp;
      if (tm.esp32 !== undefined) v.esp32 = tm.esp32;
      if (tm.lidarHz !== undefined) v.lidarHz = tm.lidarHz;
      if (tm.vbat !== undefined) v.vbat = tm.vbat;
      if (tm.phase !== undefined) v.phase = (['TO_START', 'LOADING', 'TO_TARGET', 'UNLOADING'].includes(tm.phase) ? tm.phase : null) as Phase | null;
      if (tm.goal !== undefined) v.goal = tm.goal || null;
    }
    if (u.status !== undefined) {
      if (u.status === 'ERROR' && (v.status !== 'ERROR' || u.emergencyReason)) {
        if (v.status !== 'ERROR') v.prevStatus = v.status;
        v.status = 'ERROR';
        makeErr(v, u.emergencyReason, u.emergencyCode, u.emergencySource);
      } else if (u.status !== 'ERROR') {
        v.status = u.status;
        v.err = null;
      }
      v.online = v.status !== 'OFFLINE';
    }
    v.lastHb = now();
    emit();
  });

  socket.on('log:new', (a: ApiLog) => {
    const l = toLog(a);
    if (S.logs.some((x) => x.id === l.id)) return;
    S.logs.unshift(l);
    if (S.logs.length > 500) S.logs.length = 500;
    if (l.level === 'ERROR' && l.vid) {
      const v = veh(l.vid);
      S.notes.unshift({ id: S.seq.note++, vid: l.vid, text: `${v?.name ?? l.vid}: ${l.message}`, at: l.at, read: false });
      if (S.sound) playAlarm();
      // 異常の理由をログで補う（vehicle:update より後に届いた場合）
      if (v && v.status === 'ERROR' && v.err?.code === 'UNKNOWN') makeErr(v);
    }
    emit();
  });

  socket.on('tasks:changed', () => {
    reloadTasks();
  });

  // 車両の登録・削除
  socket.on('vehicles:changed', () => {
    loadVehicles()
      .then(() => {
        relink();
        if (S.drawer?.type === 'vehicle' && !veh(S.drawer.id)) S.drawer = null;
        emit();
      })
      .catch((e) => console.error('車両の取得に失敗しました:', e));
  });

  // 運行の設定の変更（ほかの端末で保存されたとき）
  socket.on('settings:changed', (st: { ops?: OpsSettings }) => {
    applyOps(st?.ops);
    emit();
  });
}

// ---------------------------------------------------------------
// ログイン・ログアウト（App.tsx から呼ぶ）
// ---------------------------------------------------------------
let logoutFn: () => void = () => {};

export function startSession(user: { username: string; role: string }, logout: () => void) {
  logoutFn = logout;
  const role = (['ADMIN', 'OPERATOR', 'VIEWER'].includes(user.role) ? user.role : 'VIEWER') as Role;
  S.user = { name: user.username, role };
  S.users = [{ id: 'me', name: user.username, email: '—', role, created: '—' }];
  listen();
  if (socket.connected) S.server = true;
  reloadAll();
}

export function endSession() {
  Object.assign(S, { loaded: false, vehicles: [], tasks: [], logs: [], notes: [], drawer: null, modal: null, popover: null, mapMode: null });
  emit();
}

export function logout() {
  S.popover = null;
  logoutFn();
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
  loadTaskHistory(id);
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
// 安全（緊急停止・解除）— Socket.IO の既存イベント
// ---------------------------------------------------------------
export async function estop(id: string) {
  const v = veh(id);
  if (!v || !v.online || v.status === 'ERROR') return;
  const res = await emitWithAck('manual_emergency_stop', { vehicleId: id });
  if (res.ok) toast(`${v.name} に緊急停止を送信しました`, 'warn');
  else toast(`${v.name} の緊急停止: ${res.error}`, 'error');
}

// 全車停止：止められる車両すべてに緊急停止を送る
export async function stopAll() {
  const targets = S.vehicles.filter((v) => v.online && v.status !== 'ERROR');
  if (!targets.length) return toast('止める対象の車両がありません', 'warn');
  const results = await Promise.all(targets.map((v) => emitWithAck('manual_emergency_stop', { vehicleId: v.id })));
  const ng = results.filter((r) => !r.ok);
  if (!ng.length) toast(`全車停止を送信しました（${targets.length}台）`, 'warn');
  else toast(`全車停止: ${targets.length - ng.length}台に送信、${ng.length}台は失敗（${ng[0].error}）`, 'error');
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
      '解除すると、車両に CLEAR_EMERGENCY を送り、待機状態に戻します。',
    ],
    check: '車両の周りに人や障害物がないことを確認しました',
    ok: '解除する',
    danger: true,
    onOk: () => clearEmergency(id),
  });
}

export async function clearEmergency(id: string) {
  const v = veh(id);
  if (!v) return;
  const res = await emitWithAck('acknowledge_emergency', { vehicleId: id });
  if (res.ok) toast(`${v.name} を解除しました`, 'ok');
  else toast(`${v.name} の解除: ${res.error}`, 'error');
}

// ---------------------------------------------------------------
// 運行操作（バックエンドに命令APIが無いので未対応）
// ---------------------------------------------------------------
export const pause = (_id: string) => notSupported();
export const resume = (_id: string) => notSupported();
export const confirmLoad = (_id: string) => notSupported();
export const askHome = (_id: string) => notSupported();
export const startMapMode = (_type: 'goto' | 'pose', _vid: string) => notSupported();

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
export function askGoto(_vid: string, _target: { name?: string; label?: string; x: number; y: number }) {
  S.mapMode = null;
  notSupported();
}
export function mapModeClick(_p: Pt) {
  S.mapMode = null;
  notSupported();
}

// ---------------------------------------------------------------
// タスク — 既存の REST API
// ---------------------------------------------------------------
type TaskInput = { title: string; start: string; target: string; priority: number; scheduledAt: number | null };
const toBody = (d: TaskInput) => ({
  title: d.title,
  startLocation: d.start,
  targetLocation: d.target,
  priority: d.priority,
  scheduledAt: d.scheduledAt ? new Date(d.scheduledAt).toISOString() : null,
});

// 作成したタスクを返す。失敗したら Error（画面にそのまま出す文言）を投げる
export async function createTask(d: TaskInput): Promise<Task> {
  try {
    const res = await api.post<ApiTask>('/tasks', toBody(d));
    const t = toTask(res.data);
    if (!task(t.id)) S.tasks.push(t);
    emit();
    return t;
  } catch (e) {
    throw new Error(errMsg(e, 'タスクの作成に失敗しました'));
  }
}

export async function updateTask(id: string, d: TaskInput) {
  try {
    await api.patch(`/tasks/${id}`, toBody(d));
    toast(`${task(id)?.no ?? id} を保存しました`, 'ok');
  } catch (e) {
    toast(errMsg(e, 'タスクの保存に失敗しました'), 'error');
  }
}

export async function startTask(tid: string, vid: string) {
  const t = task(tid);
  const v = veh(vid);
  if (!t || !v) return;
  try {
    await api.post('/tasks/assign', { taskId: tid, vehicleId: vid });
    toast(`${t.no} を ${v.name} に割り当てました`, 'ok');
    if (!S.mqtt) toast('MQTTブローカーに接続されていないため、命令はまだ車両に届いていません', 'error');
  } catch (e) {
    toast(errMsg(e, '割り当てに失敗しました'), 'error');
  }
}

export function askCancel(tid: string) {
  const t = task(tid);
  if (!t) return;
  const running = isActive(t.status);
  const v = veh(t.vehicleId);
  openModal({
    kind: 'confirm',
    title: running ? 'タスクの中止' : 'タスクの取り消し',
    body: running
      ? `${t.no}「${t.title}」を中止します。${v?.name ?? '車両'}に中止の命令（CANCEL_TASK）を送ります。`
      : `${t.no}「${t.title}」を取り消します。`,
    detail: running ? ['荷物を積んでいる場合は、車両のところまで行って荷物を確認してください。'] : undefined,
    ok: running ? '中止する' : '取り消す',
    danger: true,
    onOk: () => cancelTask(tid),
  });
}

export async function cancelTask(tid: string) {
  const t = task(tid);
  if (!t) return;
  const running = isActive(t.status);
  try {
    const res = await api.delete<{ warning?: string }>(`/tasks/${tid}`);
    toast(`${t.no} を${running ? '中止' : '取り消'}しました`, 'warn');
    if (res.data?.warning) toast(res.data.warning, 'error');
  } catch (e) {
    toast(errMsg(e, `${running ? '中止' : '取り消し'}に失敗しました`), 'error');
  }
}

// 割り当て候補（モーダルで使う）。選べない車両には理由を付ける
export function candidates(tid: string) {
  const t = task(tid);
  const s = wpByName(t?.start);
  const list = S.vehicles.map((v) => {
    let ng: string | null = null;
    if (!v.online) ng = 'オフライン';
    else if (v.status === 'ERROR') ng = '異常中';
    else if (v.taskId) ng = '別のタスクを実行中';
    else if (v.mode === 'GOTO') ng = '移動中';
    else if ((v.battery ?? 0) < S.ops.battMin) ng = `電池残量不足（${S.ops.battMin}%未満）`;
    const dist = s ? Math.abs(v.x - s.x) + Math.abs(v.y - s.y) : null;
    return { v, ng, dist };
  });
  const rec = list.filter((c) => !c.ng).sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0))[0]?.v.id ?? null;
  return { list, rec };
}

// ---------------------------------------------------------------
// 設定（ユーザー）— APIが無いので未対応
// ---------------------------------------------------------------
export const saveUser = (_d: { id?: string; name: string; email: string; role: Role }) => notSupported();
export const askDeleteUser = (_id: string) => notSupported();

// ---------------------------------------------------------------
// 設定（車両）— POST / PATCH / DELETE /api/vehicles（ADMIN のみ）
// ---------------------------------------------------------------
// 成功したら true。失敗したら Error（画面にそのまま出す文言）を投げる
export async function saveVehicle(d: { id: string; name: string }, isNew: boolean) {
  try {
    if (isNew) await api.post('/vehicles', d);
    else await api.patch(`/vehicles/${encodeURIComponent(d.id)}`, { name: d.name });
  } catch (e) {
    throw new Error(errMsg(e, isNew ? '車両の登録に失敗しました' : '車両の保存に失敗しました'));
  }
  // 一覧の更新は vehicles:changed / vehicle:update で届くが、届く前に画面を合わせておく
  const v = veh(d.id);
  if (v) v.name = d.name;
  else await loadVehicles().then(relink).catch(() => {});
  emit();
  toast(isNew ? `${d.name}（${d.id}）を登録しました` : `${d.name} を保存しました`, 'ok');
  return true;
}

export function askDeleteVehicle(id: string) {
  const v = veh(id);
  if (!v) return;
  openModal({
    kind: 'confirm',
    title: `${v.name}（${v.id}）を削除`,
    body: 'この車両を一覧から削除します。',
    detail: [
      'この車両のログもすべて消えます（元に戻せません）。',
      '割り当て済み・実行中のタスクがある車両は削除できません。',
      '車両が telemetry を送り続けている場合、届いた時点で自動的に再登録されます。',
    ],
    check: 'ログも消えることを確認しました',
    ok: '削除する',
    danger: true,
    onOk: () => deleteVehicle(id),
  });
}

async function deleteVehicle(id: string) {
  const v = veh(id);
  try {
    await api.delete(`/vehicles/${encodeURIComponent(id)}`);
    S.vehicles = S.vehicles.filter((x) => x.id !== id);
    S.logs = S.logs.filter((l) => l.vid !== id);
    if (S.drawer?.type === 'vehicle' && S.drawer.id === id) S.drawer = null;
    emit();
    toast(`${v?.name ?? id} を削除しました`, 'warn');
  } catch (e) {
    toast(errMsg(e, '車両の削除に失敗しました'), 'error');
  }
}

// 【仮】テスト用：車両を手動でオンライン／オフラインにする（実機なしで画面の動きを確かめるため）
// POST /api/vehicles/:id/test-online。実機の確認ができるようになったら消す
export async function setTestOnline(id: string, online: boolean) {
  const v = veh(id);
  try {
    await api.post(`/vehicles/${encodeURIComponent(id)}/test-online`, { online });
    toast(`【テスト】${v?.name ?? id} を${online ? 'オンライン' : 'オフライン'}にしました`, online ? 'ok' : 'warn');
  } catch (e) {
    toast(errMsg(e, 'オンライン・オフラインの切り替えに失敗しました'), 'error');
  }
}

// ---------------------------------------------------------------
// 運行の設定 — PUT /api/settings（ADMIN のみ）
// ---------------------------------------------------------------
export async function saveOps(o: OpsSettings) {
  try {
    const res = await api.put<{ ops: OpsSettings }>('/settings', { ops: o });
    applyOps(res.data.ops);
    emit();
    toast('運行の設定を保存しました', 'ok');
  } catch (e) {
    toast(errMsg(e, '運行の設定の保存に失敗しました'), 'error');
  }
}

// ---------------------------------------------------------------
// 異常のときの音（音のファイルは使わず、ブラウザで鳴らす）
// ---------------------------------------------------------------
let audioCtx: AudioContext | null = null;
let lastAlarm = 0;
export function playAlarm(force = false) {
  const t = now();
  if (!force && t - lastAlarm < 3000) return; // 続けて届いても3秒に1回まで
  lastAlarm = t;
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    const ctx = audioCtx;
    // ピッ・ピッ・ピッ（880Hz を3回）
    [0, 0.25, 0.5].forEach((d) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 880;
      const st = ctx.currentTime + d;
      gain.gain.setValueAtTime(0.0001, st);
      gain.gain.exponentialRampToValueAtTime(0.15, st + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, st + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(st);
      osc.stop(st + 0.2);
    });
  } catch {
    /* 音を鳴らせない環境では何もしない */
  }
}
