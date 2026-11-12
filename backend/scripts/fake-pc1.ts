// scripts/fake-pc1.ts
// 偽の PC1（ROS 側）。実機がなくても Web をつないで確かめるための道具。
// docs/agv_protocol.md のとおりに MQTT で話す：
//   送る … agv/{id}/telemetry（2Hz と 1Hz）、agv/{id}/task、agv/{id}/path、agv/{id}/online、agv/{id}/emergency
//   受ける … agv/{id}/command（TASK_ASSIGN・PAUSE・RESUME・CANCEL_TASK・CONFIRM・GOTO・RETURN_HOME・SET_POSE・
//            EMERGENCY_STOP・CLEAR_EMERGENCY・MANUAL_DRIVE）と agv/broadcast/stop
//
// 使い方（ルートで）:  npm run fake-pc1 -w backend -- AGV-01 AGV-02
//   --confirm … 荷積み・荷降ろしを「積み降ろし完了（CONFIRM）」が来るまで待つ（mission.yaml の wait_mode: confirm と同じ）
//   MQTT_BROKER_URL … 接続先（無ければ mqtt://localhost:1883）
//
// 本物との違い：経路は壁を避けず、まっすぐ（曲がり角なし）に走る。センサーやバッテリーの値は作りもの。
// GOTO・RETURN_HOME の結果（taskId: null の agv/{id}/task）は、到着したときの COMPLETED だけ送る。
import fs from 'node:fs';
import path from 'node:path';
import mqtt, { type MqttClient } from 'mqtt';
import { parse } from 'yaml';

const BROKER = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const args = process.argv.slice(2);
const CONFIRM_MODE = args.includes('--confirm');
const IDS = args.filter((a) => !a.startsWith('--'));
if (!IDS.length) IDS.push('AGV-01');

const MAP_ID = 'demo_map';
const SPEED = 0.4; // m/s
const TURN = 1.5; // rad/s
const WAIT_SEC = 5; // 荷積み・荷降ろし（wait_mode: timer のとき）
const MANUAL_TIMEOUT_MS = 500; // 手動操縦の命令が途切れたら止まる（ROS 側にお願いしている動き）
const TICK_MS = 100;

// ---------------------------------------------------------------
// 地点（ROS と同じ waypoints.yaml を読む。読むだけ）
// ---------------------------------------------------------------
type Wp = { name: string; x: number; y: number; theta_deg?: number; charger?: boolean; aliases?: string[] };
const WP_FILE = path.resolve(__dirname, '../../edge_ai/ros2_ws/src/agv_navigation/config/waypoints.yaml');
const WAYPOINTS: Wp[] = (parse(fs.readFileSync(WP_FILE, 'utf8')) as { waypoints: Wp[] }).waypoints;

// 地点名・別名・"x,y" のどれでも探す（PC1 と同じ）
function resolve(loc: unknown): { name: string; x: number; y: number; charger?: boolean } | null {
  if (typeof loc !== 'string' || !loc) return null;
  const w = WAYPOINTS.find((p) => p.name === loc || p.aliases?.includes(loc));
  if (w) return w;
  const m = loc.split(',').map(Number);
  return m.length === 2 && m.every(Number.isFinite) ? { name: loc, x: m[0], y: m[1] } : null;
}

// ---------------------------------------------------------------
// 1台分
// ---------------------------------------------------------------
type Phase = 'TO_START' | 'LOADING' | 'TO_TARGET' | 'UNLOADING';
type Task = { id: string; title: string; start: Wp | ReturnType<typeof resolve>; target: Wp | ReturnType<typeof resolve> };

class FakeVehicle {
  x: number;
  y: number;
  theta = 0;
  speed = 0;
  battery = 90;
  status: 'IDLE' | 'RUNNING' | 'CHARGING' | 'ERROR' = 'IDLE';
  paused = false;
  goal: { name: string; x: number; y: number; charger?: boolean } | null = null;
  task: Task | null = null;
  phase: Phase | null = null;
  wait = 0;
  waitingConfirm = false;
  manual: { linear: number; angular: number; until: number } | null = null;
  lastTaskPub = 0;
  client: MqttClient;

  constructor(
    public id: string,
    index: number,
  ) {
    const home = resolve('Home') ?? { x: 0, y: 0 };
    this.x = home.x + index * 0.6; // 何台か出すときは少しずらす
    this.y = home.y;
    this.client = mqtt.connect(BROKER, {
      will: { topic: `agv/${id}/online`, payload: Buffer.from(JSON.stringify({ online: false })), retain: true, qos: 1 },
    });
    this.client.on('connect', () => {
      console.log(`[${id}] MQTT に接続しました（${BROKER}）`);
      this.pub('online', { online: true }, true);
      this.client.subscribe([`agv/${id}/command`, 'agv/broadcast/stop']);
    });
    this.client.on('message', (_topic, buf) => {
      try {
        this.onCommand(JSON.parse(buf.toString()));
      } catch (e) {
        console.error(`[${id}] 命令を読めませんでした:`, e);
      }
    });
  }

  pub(kind: string, body: object, retain = false) {
    this.client.publish(`agv/${this.id}/${kind}`, JSON.stringify(body), { retain });
  }

  log(msg: string) {
    console.log(`[${this.id}] ${msg}`);
  }

  // ---- 命令 ----
  onCommand(c: Record<string, unknown>) {
    const kind = String(c.type ?? c.action ?? '');
    if (kind !== 'MANUAL_DRIVE') this.log(`命令を受信: ${JSON.stringify(c)}`);
    switch (kind) {
      case 'TASK_ASSIGN': {
        const start = resolve(c.startLocation);
        const target = resolve(c.targetLocation);
        if (this.status === 'ERROR' || !start || !target || typeof c.taskId !== 'string') {
          if (typeof c.taskId === 'string') this.taskPub(c.taskId, 'FAILED', null, 0, '受け付けられませんでした（異常中か、地点が見つからない）');
          return;
        }
        this.manual = null;
        this.task = { id: c.taskId, title: String(c.taskTitle ?? ''), start, target };
        this.moveTo(start, 'TO_START');
        this.taskPub(this.task.id, 'IN_PROGRESS', 'TO_START', 0, `${start.name} へ移動中`);
        break;
      }
      case 'CANCEL_TASK':
        if (this.task) this.taskPub(this.task.id, 'CANCELLED', this.phase, this.progress(), '中止しました');
        this.stop();
        break;
      case 'PAUSE':
        if (this.status === 'RUNNING') this.paused = true;
        break;
      case 'RESUME':
        this.paused = false;
        break;
      case 'CONFIRM':
        if (this.wait > 0 || this.waitingConfirm) {
          this.wait = 0;
          this.waitingConfirm = false;
          this.finishWait();
        }
        break;
      case 'GOTO': {
        if (this.task) return this.log('タスク実行中なので GOTO は無視しました');
        const g = typeof c.target === 'string' ? resolve(c.target) : typeof c.x === 'number' && typeof c.y === 'number' ? { name: `${c.x},${c.y}`, x: c.x, y: c.y } : null;
        if (g) this.moveTo(g, null);
        break;
      }
      case 'RETURN_HOME': {
        if (this.task) return this.log('タスク実行中なので RETURN_HOME は無視しました');
        const home = resolve('Home');
        if (home) this.moveTo(home, null);
        break;
      }
      case 'SET_POSE':
        if (typeof c.x === 'number' && typeof c.y === 'number') {
          this.x = c.x;
          this.y = c.y;
          if (typeof c.theta === 'number') this.theta = c.theta;
        }
        break;
      case 'EMERGENCY_STOP':
        this.status = 'ERROR';
        this.speed = 0;
        this.manual = null;
        this.pub('emergency', { reason: 'Webの緊急停止ボタンで停止しました', code: 'WEB_ESTOP', source: 'web' });
        break;
      case 'CLEAR_EMERGENCY':
        if (this.status === 'ERROR') this.status = this.goal || this.task ? 'RUNNING' : 'IDLE';
        break;
      case 'MANUAL_DRIVE': {
        if (this.task || this.status === 'ERROR') return; // タスク実行中・異常中は無視
        const linear = Number(c.linear) || 0;
        const angular = Number(c.angular) || 0;
        if (!linear && !angular) {
          if (this.manual) this.log('手動操縦: 停止');
          this.manual = null;
          this.speed = 0;
          if (this.status === 'RUNNING' && !this.goal) this.status = 'IDLE';
          return;
        }
        if (!this.manual) this.log('手動操縦: 開始');
        this.goal = null;
        this.manual = { linear: Math.max(-0.3, Math.min(0.3, linear)), angular: Math.max(-1, Math.min(1, angular)), until: Date.now() + MANUAL_TIMEOUT_MS };
        this.status = 'RUNNING';
        break;
      }
      default:
        this.log(`知らない命令です（無視しました）: ${kind}`);
    }
  }

  moveTo(goal: { name: string; x: number; y: number; charger?: boolean }, phase: Phase | null) {
    this.goal = goal;
    this.phase = phase;
    this.paused = false;
    this.status = 'RUNNING';
    // 経路（まっすぐ）を知らせる
    this.pub('path', { points: [[this.x, this.y], [goal.x, goal.y]], goal: { x: goal.x, y: goal.y } });
  }

  stop() {
    this.task = null;
    this.goal = null;
    this.phase = null;
    this.wait = 0;
    this.waitingConfirm = false;
    this.paused = false;
    this.speed = 0;
    if (this.status !== 'ERROR') this.status = 'IDLE';
    this.pub('path', { points: [], goal: null });
  }

  progress() {
    return { TO_START: 10, LOADING: 35, TO_TARGET: 65, UNLOADING: 90 }[this.phase ?? 'TO_START'];
  }

  taskPub(taskId: string, status: string, phase: Phase | null, progress: number, message: string) {
    this.pub('task', { taskId, status, phase, progress, message });
    this.lastTaskPub = Date.now();
  }

  arrive() {
    const g = this.goal!;
    this.goal = null;
    this.speed = 0;
    this.pub('path', { points: [], goal: null });
    if (!this.task) {
      this.status = g.charger ? 'CHARGING' : 'IDLE';
      this.log(`${g.name} に到着しました`);
      // タスクではない単発の移動の結果（docs/agv_protocol.md 2-4）
      this.pub('task', { taskId: null, command: g.name === 'Home' ? 'RETURN_HOME' : 'GOTO', goal: g.name, status: 'COMPLETED', phase: 'GOTO', progress: 100, message: `${g.name} に到着しました` });
      return;
    }
    if (this.phase === 'TO_START') this.startWait('LOADING', '荷積み中');
    else if (this.phase === 'TO_TARGET') this.startWait('UNLOADING', '荷降ろし中');
  }

  startWait(phase: Phase, msg: string) {
    this.phase = phase;
    if (CONFIRM_MODE) this.waitingConfirm = true;
    else this.wait = WAIT_SEC;
    this.taskPub(this.task!.id, 'IN_PROGRESS', phase, this.progress(), CONFIRM_MODE ? `${msg}（積み降ろし完了を待っています）` : msg);
  }

  finishWait() {
    const t = this.task!;
    if (this.phase === 'LOADING') {
      this.moveTo(t.target!, 'TO_TARGET');
      this.taskPub(t.id, 'IN_PROGRESS', 'TO_TARGET', this.progress(), `${t.target!.name} へ移動中`);
    } else if (this.phase === 'UNLOADING') {
      this.taskPub(t.id, 'COMPLETED', 'UNLOADING', 100, '完了しました');
      this.log(`タスク ${t.id} が完了しました`);
      this.stop();
    }
  }

  // ---- 0.1 秒ごとに動かす ----
  tick(dt: number) {
    if (this.status === 'ERROR') return;
    if (this.manual) {
      if (Date.now() > this.manual.until) {
        this.log('手動操縦: 命令が途切れたので停止');
        this.manual = null;
        this.speed = 0;
        this.status = 'IDLE';
        return;
      }
      // TT-02 と同じく、前後に動いているときだけ曲がる。0.12 m/s より遅い指令は 0.12 に上げる
      const lin = this.manual.linear === 0 ? 0 : Math.sign(this.manual.linear) * Math.max(0.12, Math.abs(this.manual.linear));
      if (lin !== 0) this.theta += this.manual.angular * dt * Math.sign(lin);
      this.x += Math.cos(this.theta) * lin * dt;
      this.y += Math.sin(this.theta) * lin * dt;
      this.speed = Math.abs(lin);
      return;
    }
    if (this.status === 'CHARGING') this.battery = Math.min(100, this.battery + 0.5 * dt);
    if (this.paused) {
      this.speed = 0;
      return;
    }
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait <= 0) this.finishWait();
      return;
    }
    if (!this.goal) return;
    const dx = this.goal.x - this.x;
    const dy = this.goal.y - this.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.05) return this.arrive();
    const diff = Math.atan2(Math.sin(Math.atan2(dy, dx) - this.theta), Math.cos(Math.atan2(dy, dx) - this.theta));
    this.theta += Math.sign(diff) * Math.min(Math.abs(diff), TURN * dt);
    if (Math.abs(diff) > 0.3) {
      this.speed = 0;
      return;
    }
    const step = Math.min(dist, SPEED * dt);
    this.x += (dx / dist) * step;
    this.y += (dy / dist) * step;
    this.speed = SPEED;
    this.battery = Math.max(0, this.battery - 0.05 * dt);
    // タスク中は 1 秒ごとに進捗を送る
    if (this.task && Date.now() - this.lastTaskPub > 1000) {
      this.taskPub(this.task.id, 'IN_PROGRESS', this.phase, this.progress(), `${this.goal.name} へ移動中`);
    }
  }

  // PC1（mission_manager）の telemetry（2Hz）
  sendNav() {
    this.pub('telemetry', {
      x: round(this.x),
      y: round(this.y),
      theta: round(this.theta),
      status: this.status,
      mapId: MAP_ID,
      speed: round(this.speed),
      phase: this.phase ?? '',
      taskId: this.task?.id ?? '',
      goal: this.goal?.name ?? '',
      mode: this.manual ? 'MANUAL' : this.goal ? 'NAV' : 'IDLE',
      paused: this.paused,
      note: 'fake-pc1',
      locQuality: 0.95,
    });
  }

  // ラズパイ（serial_bridge）の telemetry（1Hz）
  sendRobot() {
    this.pub('telemetry', {
      battery: Math.round(this.battery),
      vbat: round(6.4 + this.battery * 0.015),
      piTemp: round(48 + Math.sin(Date.now() / 30000) * 2),
      esp32: true,
      lidarHz: 5.5,
    });
  }

  close() {
    this.pub('online', { online: false }, true);
    this.client.end();
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;

// ---------------------------------------------------------------
// 起動
// ---------------------------------------------------------------
const vehicles = IDS.map((id, i) => new FakeVehicle(id, i));
console.log(`偽の PC1 を起動しました: ${IDS.join(', ')}（地点 ${WAYPOINTS.length} 件、${CONFIRM_MODE ? 'wait_mode: confirm' : 'wait_mode: timer'}）`);
console.log('Ctrl+C で終了します（終了時に online:false を送ります）');

let last = Date.now();
let n = 0;
setInterval(() => {
  const now = Date.now();
  const dt = (now - last) / 1000;
  last = now;
  n++;
  for (const v of vehicles) {
    v.tick(dt);
    if (n % 5 === 0) v.sendNav(); // 2Hz
    if (n % 10 === 0) v.sendRobot(); // 1Hz
  }
}, TICK_MS);

process.on('SIGINT', () => {
  vehicles.forEach((v) => v.close());
  setTimeout(() => process.exit(0), 300);
});
