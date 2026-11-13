// services/manualDriveService.ts
// Web 画面からの手動操縦（WASD）。押している間だけ、画面から 0.2 秒ごとに速度が届く。
// 車両には agv/{id}/command に {"action":"MANUAL_DRIVE","linear":m/s,"angular":rad/s} を送る。
// ※ この命令は docs/agv_protocol.md にはまだ無い（ROS 側と取り決めて、受け取る処理を作ってもらう必要がある）
import { LogLevel, Role, TaskStatus, VehicleStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { mqttService } from './mqttService';
import { emergencyState } from './emergencyState';
import type { AuthUser } from '../types/express';

export const MAX_LINEAR = 0.3; // m/s（前後の速さの上限）
export const MAX_ANGULAR = 1.0; // rad/s（その場で回る速さの上限）
const TIMEOUT_MS = 600; // これだけ画面から届かなければ止める（タブを閉じた・通信が切れたなど）
const WATCH_MS = 200;

type Session = { vehicleId: string; userId: string; username: string; socketId: string; lastAt: number };
type Result = { ok: boolean; error?: string };
type LogFn = (vehicleId: string, level: LogLevel, message: string) => Promise<unknown>;

const clamp = (v: number, max: number) => Math.round(Math.max(-max, Math.min(max, v)) * 100) / 100;

class ManualDriveService {
  private sessions = new Map<string, Session>(); // 車両ID → 操縦中の人
  private timer: NodeJS.Timeout | null = null;
  private log: LogFn = async () => {};

  start(log: LogFn) {
    this.log = log;
    if (this.timer) return;
    this.timer = setInterval(() => this.checkTimeouts(), WATCH_MS);
  }

  isDriving(vehicleId: string) {
    return this.sessions.has(vehicleId);
  }

  private send(vehicleId: string, linear: number, angular: number) {
    mqttService.sendVehicleCommand(vehicleId, { action: 'MANUAL_DRIVE', linear, angular });
  }

  // 止めて、操縦を終わりにする
  private end(s: Session, reason: string) {
    this.sessions.delete(s.vehicleId);
    this.send(s.vehicleId, 0, 0);
    this.log(s.vehicleId, LogLevel.INFO, `手動操縦を終了しました（${reason}・操作: ${s.username}）`).catch(() => {});
  }

  /** 画面から届いた速度を車両に送る。押していないときは linear・angular とも 0 が届く */
  async drive(user: AuthUser, socketId: string, data: unknown): Promise<Result> {
    if (user.role === Role.VIEWER) return { ok: false, error: '閲覧のみの権限では操縦できません' };

    const d = (data ?? {}) as { vehicleId?: unknown; linear?: unknown; angular?: unknown };
    const vehicleId = typeof d.vehicleId === 'string' ? d.vehicleId : '';
    const linear = Number(d.linear);
    const angular = Number(d.angular);
    if (!vehicleId) return { ok: false, error: '車両IDが指定されていません' };
    if (!Number.isFinite(linear) || !Number.isFinite(angular)) return { ok: false, error: '速度の指定が正しくありません' };

    const current = this.sessions.get(vehicleId);
    if (current && current.socketId !== socketId) {
      return { ok: false, error: `${current.username} さんが操縦中です` };
    }

    const lin = clamp(linear, MAX_LINEAR);
    const ang = clamp(angular, MAX_ANGULAR);
    const moving = lin !== 0 || ang !== 0;

    // 止める指示は、車両の状態にかかわらず必ず送る
    if (!moving) {
      if (current) this.end(current, 'キーを離した');
      else this.send(vehicleId, 0, 0);
      return { ok: true };
    }

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { status: true } });
    if (!vehicle) return { ok: false, error: '車両が見つかりません' };
    const ng =
      vehicle.status === VehicleStatus.OFFLINE
        ? 'オフラインの車両は操縦できません'
        : // 自己位置を見失った・障害物で進めないなど自動で戻る異常のときは、手で動かして立て直せるようにする（emergencyState.ts）
          vehicle.status === VehicleStatus.ERROR && !(await emergencyState.isRecoverable(vehicleId))
          ? '異常中の車両は操縦できません。先に緊急状態を解除してください'
          : (await prisma.task.count({
                where: { assignedVehicleId: vehicleId, status: { in: [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS] } },
              })) > 0
            ? 'タスクを実行中の車両は操縦できません。先にタスクを中止してください'
            : null;
    if (ng) {
      if (current) this.end(current, ng);
      return { ok: false, error: ng };
    }

    if (!current) {
      this.sessions.set(vehicleId, { vehicleId, userId: user.id, username: user.username, socketId, lastAt: Date.now() });
      await this.log(vehicleId, LogLevel.INFO, `手動操縦を開始しました（操作: ${user.username}）`);
    } else {
      current.lastAt = Date.now();
    }
    this.send(vehicleId, lin, ang);

    if (!mqttService.isConnected()) {
      return { ok: false, error: 'MQTTブローカーに接続されていないため、操縦の命令が車両に届いていません' };
    }
    return { ok: true };
  }

  /** 緊急停止など、ほかの理由でその車両の操縦を打ち切る */
  stopVehicle(vehicleId: string, reason: string) {
    const s = this.sessions.get(vehicleId);
    if (s) this.end(s, reason);
  }

  /** 画面の接続が切れたら、その画面で操縦していた車両を止める */
  stopBySocket(socketId: string) {
    for (const s of [...this.sessions.values()]) {
      if (s.socketId === socketId) this.end(s, '画面の接続が切れた');
    }
  }

  private checkTimeouts() {
    const now = Date.now();
    for (const s of [...this.sessions.values()]) {
      if (now - s.lastAt > TIMEOUT_MS) this.end(s, '画面からの指示が途切れた');
    }
  }
}

export const manualDriveService = new ManualDriveService();
