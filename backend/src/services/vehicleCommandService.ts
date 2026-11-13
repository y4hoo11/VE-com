// services/vehicleCommandService.ts
// 画面からの運行操作を、docs/agv_protocol.md 2-1 の形で車両（agv/{id}/command）に送る。
// 一時停止・再開、積み降ろし完了、地点へ移動、ホームへ戻る、現在地の設定
import { LogLevel, Role, TaskStatus, VehicleStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { mqttService } from './mqttService';
import { manualDriveService } from './manualDriveService';
import { emergencyState } from './emergencyState';
import type { AuthUser } from '../types/express';

type Result = { ok: boolean; error?: string };
type LogFn = (vehicleId: string, level: LogLevel, message: string) => Promise<unknown>;

export const COMMAND_TYPES = ['PAUSE', 'RESUME', 'CONFIRM', 'GOTO', 'RETURN_HOME', 'SET_POSE'] as const;
type CommandType = (typeof COMMAND_TYPES)[number];

// タスク実行中・手動操縦中には送らない命令（車両が別の行き先に動き出してしまうため）
const MOVES: CommandType[] = ['GOTO', 'RETURN_HOME', 'SET_POSE'];

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

class VehicleCommandService {
  private log: LogFn = async () => {};

  start(log: LogFn) {
    this.log = log;
  }

  async handle(user: AuthUser, data: unknown): Promise<Result> {
    if (user.role === Role.VIEWER) return { ok: false, error: '閲覧のみの権限では操作できません' };

    const d = (data ?? {}) as Record<string, unknown>;
    const vehicleId = typeof d.vehicleId === 'string' ? d.vehicleId : '';
    const type = d.type as CommandType;
    if (!vehicleId) return { ok: false, error: '車両IDが指定されていません' };
    if (!COMMAND_TYPES.includes(type)) return { ok: false, error: '命令の種類が正しくありません' };

    // 命令の中身（JSON）と、ログに残す説明
    let command: object;
    let desc: string;
    switch (type) {
      case 'PAUSE':
        command = { action: 'PAUSE' };
        desc = '一時停止';
        break;
      case 'RESUME':
        command = { action: 'RESUME' };
        desc = '再開';
        break;
      case 'CONFIRM':
        command = { action: 'CONFIRM' };
        desc = '積み降ろし完了';
        break;
      case 'RETURN_HOME':
        command = { type: 'RETURN_HOME' };
        desc = 'ホームへ戻る';
        break;
      case 'GOTO': {
        const target = typeof d.target === 'string' ? d.target.trim() : '';
        const x = num(d.x);
        const y = num(d.y);
        if (target) {
          command = { type: 'GOTO', target };
          desc = `${target} へ移動`;
        } else if (x != null && y != null) {
          command = { type: 'GOTO', x, y };
          desc = `(${x.toFixed(2)}, ${y.toFixed(2)}) へ移動`;
        } else {
          return { ok: false, error: '移動先が指定されていません' };
        }
        break;
      }
      case 'SET_POSE': {
        const x = num(d.x);
        const y = num(d.y);
        const theta = num(d.theta);
        if (x == null || y == null || theta == null) return { ok: false, error: '現在地の指定が正しくありません' };
        command = { action: 'SET_POSE', x, y, theta };
        desc = `現在地を設定（x ${x.toFixed(2)} / y ${y.toFixed(2)} / 向き ${Math.round((theta * 180) / Math.PI)}°）`;
        break;
      }
    }

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { status: true } });
    if (!vehicle) return { ok: false, error: '車両が見つかりません' };
    if (vehicle.status === VehicleStatus.OFFLINE) return { ok: false, error: 'オフラインの車両には送れません' };
    // 異常中は送らない。ただし、自己位置を見失った・障害物で進めないなど自動で戻る異常のときは、
    // 立て直すための「現在地の設定」だけは送れる（emergencyState.ts）
    if (vehicle.status === VehicleStatus.ERROR && !(type === 'SET_POSE' && (await emergencyState.isRecoverable(vehicleId)))) {
      return { ok: false, error: '異常中の車両には送れません。先に緊急状態を解除してください' };
    }

    if (MOVES.includes(type)) {
      if (manualDriveService.isDriving(vehicleId)) return { ok: false, error: '手動操縦中です。操縦をやめてから操作してください' };
      const active = await prisma.task.count({
        where: { assignedVehicleId: vehicleId, status: { in: [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS] } },
      });
      if (active > 0) return { ok: false, error: 'タスクを実行中です。先にタスクを中止してください' };
    }

    mqttService.sendVehicleCommand(vehicleId, command);
    await this.log(vehicleId, LogLevel.INFO, `${desc}を指示しました（操作: ${user.username}）`);

    if (!mqttService.isConnected()) {
      return { ok: false, error: 'MQTTブローカーに接続されていないため、命令がまだ車両に届いていません' };
    }
    return { ok: true };
  }
}

export const vehicleCommandService = new VehicleCommandService();
