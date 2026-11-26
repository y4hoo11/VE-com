// services/manualDriveService.ts
// Web 画面からの手動操縦（WASD）。
//
// 「操縦を始める」から「操縦をやめる」までを 1 回の操縦として扱い、ログはその開始と終了だけ残す
// （キーを押す・離すたびには残さない）。操縦中は、ほかの人はその車両を操縦できない。
//
//   manual_drive_start … 「操縦を始める」を押した
//   manual_drive       … キーを押している間、画面から 0.2 秒ごとに速度が届く。離すと 0 が 1 回届く
//   manual_drive_end   … 「操縦をやめる」を押した・ページを離れた
//
// 車両には agv/{id}/command に {"action":"MANUAL_DRIVE","linear":m/s,"angular":rad/s} を送る（docs/agv_protocol.md 2-1）
import { LogLevel, Role, TaskStatus, VehicleStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { mqttService } from './mqttService';
import { emergencyState } from './emergencyState';
import { requestDispatch } from './dispatchTrigger';
import type { AuthUser } from '../types/express';

export const MAX_LINEAR = 0.3; // m/s（前後の速さの上限）
export const MAX_ANGULAR = 1.0; // rad/s（回る速さの上限）
const MOVE_TIMEOUT_MS = 600; // 動いている最中に、これだけ画面から届かなければ車両を止める（通信が切れたなど）
const IDLE_TIMEOUT_MS = 3 * 60 * 1000; // これだけ何も操作がなければ、操縦を終わりにする（始めたまま忘れたとき）
const WATCH_MS = 200;

type Session = {
  vehicleId: string;
  userId: string;
  username: string;
  socketId: string;
  lastAt: number; // 最後に操作が届いた時刻
  moving: boolean; // いま速度を送っているか
};
type Result = { ok: boolean; error?: string };
type LogFn = (vehicleId: string, level: LogLevel, message: string) => Promise<unknown>;

const clamp = (v: number, max: number) => Math.round(Math.max(-max, Math.min(max, v)) * 100) / 100;
const readVehicleId = (data: unknown) => {
  const id = (data as { vehicleId?: unknown } | null)?.vehicleId;
  return typeof id === 'string' ? id : '';
};

class ManualDriveService {
  private sessions = new Map<string, Session>(); // 車両ID → 操縦中の人
  private timer: NodeJS.Timeout | null = null;
  private log: LogFn = async () => {};

  start(log: LogFn) {
    this.log = log;
    if (this.timer) return;
    this.timer = setInterval(() => this.checkTimeouts(), WATCH_MS);
  }

  /** その車両が手動操縦中か（操縦を始めてから、やめるまで） */
  isDriving(vehicleId: string) {
    return this.sessions.has(vehicleId);
  }

  /** そのユーザーが、どれかの車両を手動操縦中か（操縦中は、別の端末からのログインを断るため） */
  isUserDriving(userId: string) {
    return [...this.sessions.values()].some((s) => s.userId === userId);
  }

  private send(vehicleId: string, linear: number, angular: number) {
    mqttService.sendVehicleCommand(vehicleId, { action: 'MANUAL_DRIVE', linear, angular });
  }

  // 操縦を始めてよいか（だめなら理由）
  private async whyNot(user: AuthUser, socketId: string, vehicleId: string): Promise<string | null> {
    if (user.role === Role.VIEWER) return '閲覧のみの権限では操縦できません';
    if (!vehicleId) return '車両IDが指定されていません';
    const current = this.sessions.get(vehicleId);
    if (current && current.socketId !== socketId) return `${current.username} さんが操縦中です`;

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { status: true } });
    if (!vehicle) return '車両が見つかりません';
    if (vehicle.status === VehicleStatus.OFFLINE) return 'オフラインの車両は操縦できません';
    // 自己位置を見失った・障害物で進めないなど自動で戻る異常のときは、手で動かして立て直せるようにする（emergencyState.ts）
    if (vehicle.status === VehicleStatus.ERROR && !(await emergencyState.isRecoverable(vehicleId))) {
      return '異常中の車両は操縦できません。先に緊急状態を解除してください';
    }
    const active = await prisma.task.count({
      where: { assignedVehicleId: vehicleId, status: { in: [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS] } },
    });
    if (active > 0) return 'タスクを実行中の車両は操縦できません。先にタスクを中止してください';
    return null;
  }

  private async open(user: AuthUser, socketId: string, vehicleId: string) {
    const s: Session = { vehicleId, userId: user.id, username: user.username, socketId, lastAt: Date.now(), moving: false };
    this.sessions.set(vehicleId, s);
    await this.log(vehicleId, LogLevel.INFO, `手動操縦を開始しました（操作: ${user.username}）`);
    return s;
  }

  // 車両を止めて、操縦を終わりにする
  private close(s: Session, reason?: string) {
    this.sessions.delete(s.vehicleId);
    this.send(s.vehicleId, 0, 0);
    const why = reason ? `${reason}・` : '';
    this.log(s.vehicleId, LogLevel.INFO, `手動操縦を終了しました（${why}操作: ${s.username}）`).catch(() => {});
    requestDispatch('手動操縦の終了');
  }

  /** 「操縦を始める」を押した */
  async begin(user: AuthUser, socketId: string, data: unknown): Promise<Result> {
    const vehicleId = readVehicleId(data);
    const ng = await this.whyNot(user, socketId, vehicleId);
    if (ng) return { ok: false, error: ng };
    if (!this.sessions.has(vehicleId)) await this.open(user, socketId, vehicleId);
    return { ok: true };
  }

  /** 「操縦をやめる」を押した・ページを離れた */
  finish(socketId: string, data: unknown): Result {
    const s = this.sessions.get(readVehicleId(data));
    if (s && s.socketId === socketId) this.close(s);
    return { ok: true };
  }

  /** 画面から届いた速度を車両に送る。押していないときは linear・angular とも 0 が届く */
  async drive(user: AuthUser, socketId: string, data: unknown): Promise<Result> {
    const d = (data ?? {}) as { linear?: unknown; angular?: unknown };
    const vehicleId = readVehicleId(data);
    const linear = Number(d.linear);
    const angular = Number(d.angular);
    if (!vehicleId) return { ok: false, error: '車両IDが指定されていません' };
    if (!Number.isFinite(linear) || !Number.isFinite(angular)) return { ok: false, error: '速度の指定が正しくありません' };

    let current = this.sessions.get(vehicleId);
    if (current && current.socketId !== socketId) {
      return { ok: false, error: `${current.username} さんが操縦中です` };
    }

    const lin = clamp(linear, MAX_LINEAR);
    const ang = clamp(angular, MAX_ANGULAR);

    // 止める指示（キーを離した）は、車両の状態にかかわらず必ず送る。操縦は続いている
    if (lin === 0 && ang === 0) {
      this.send(vehicleId, 0, 0);
      if (current) {
        current.moving = false;
        current.lastAt = Date.now();
      }
      return { ok: true };
    }

    const ng = await this.whyNot(user, socketId, vehicleId);
    if (ng) {
      if (current) this.close(current, ng);
      return { ok: false, error: ng };
    }

    // 「操縦を始める」を経ずに届いたとき（操作がなくて一度終わったあとなど）は、ここで始める
    current = this.sessions.get(vehicleId) ?? (await this.open(user, socketId, vehicleId));
    current.moving = true;
    current.lastAt = Date.now();
    this.send(vehicleId, lin, ang);

    if (!mqttService.isConnected()) {
      return { ok: false, error: 'MQTTブローカーに接続されていないため、操縦の命令が車両に届いていません' };
    }
    return { ok: true };
  }

  /** 緊急停止など、ほかの理由でその車両の操縦を打ち切る */
  stopVehicle(vehicleId: string, reason: string) {
    const s = this.sessions.get(vehicleId);
    if (s) this.close(s, reason);
  }

  /** 画面の接続が切れたら、その画面で操縦していた車両を止める */
  stopBySocket(socketId: string) {
    for (const s of [...this.sessions.values()]) {
      if (s.socketId === socketId) this.close(s, '画面の接続が切れた');
    }
  }

  private checkTimeouts() {
    const now = Date.now();
    for (const s of [...this.sessions.values()]) {
      if (s.moving && now - s.lastAt > MOVE_TIMEOUT_MS) {
        // 動いている最中に指示が途切れた：車両は止めるが、操縦は続いている（ログは残さない）
        s.moving = false;
        this.send(s.vehicleId, 0, 0);
      } else if (now - s.lastAt > IDLE_TIMEOUT_MS) {
        this.close(s, '操作がなかった');
      }
    }
  }
}

export const manualDriveService = new ManualDriveService();
