// src/services/socketService.ts
import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { VehicleUpdatePayload, LogPayload } from '../types';
import { mqttService } from './mqttService';
import { prisma } from '../config/database';
import { VehicleStatus, LogLevel } from '@prisma/client';
import { verifyToken } from '../middleware/auth';
import type { AuthUser } from '../types/express';

// フロントからのイベントに返す結果（フロントはこれで成功・失敗を表示する）
type Ack = (result: { ok: boolean; error?: string }) => void;

// イベントのデータから車両IDを安全に取り出す
const getVehicleId = (data: unknown): string | undefined => {
  const id = (data as { vehicleId?: unknown } | null)?.vehicleId;
  return typeof id === 'string' && id ? id : undefined;
};

class SocketService {
  private io: Server | null = null;

  init(httpServer: HttpServer) {
    this.io = new Server(httpServer, {
      cors: { origin: '*' },
    });

    // 接続時にトークンを確認する（フロントは io(url, { auth: { token } }) で送る）
    this.io.use((socket, next) => {
      const token = socket.handshake.auth?.token;
      const user = typeof token === 'string' ? verifyToken(token) : null;
      if (!user) return next(new Error('unauthorized'));
      socket.data.user = user;
      next();
    });

    this.io.on('connection', (socket: Socket) => {
      const user = socket.data.user as AuthUser;
      console.log(`[WebSocket] フロントエンド接続: ${socket.id} (${user.username})`);

      // Web画面からの手動緊急停止指示
      socket.on('manual_emergency_stop', async (data: unknown, ack?: Ack) => {
        const vehicleId = getVehicleId(data);
        if (!vehicleId) return ack?.({ ok: false, error: '車両IDが指定されていません' });

        try {
          const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
          if (!vehicle) return ack?.({ ok: false, error: '車両が見つかりません' });

          console.warn(`[緊急] Webからの停止命令を受信: ${vehicleId} (${user.username})`);
          mqttService.sendEmergencyStop(vehicleId);

          await this.recordLog(vehicleId, LogLevel.ERROR, `Webから緊急停止を指示しました（操作: ${user.username}）`);

          // ブローカーにつながっていない場合、命令は再接続まで待たされる。届いていないことを操作者に伝える
          if (!mqttService.isConnected()) {
            return ack?.({
              ok: false,
              error: 'MQTTブローカーに接続されていないため、停止命令がまだ車両に届いていません',
            });
          }
          ack?.({ ok: true });
        } catch (e) {
          console.error('緊急停止の処理エラー:', e);
          ack?.({ ok: false, error: '緊急停止の送信に失敗しました' });
        }
      });

      // Web画面の「確認」ボタン等による緊急状態の解除
      socket.on('acknowledge_emergency', async (data: unknown, ack?: Ack) => {
        const vehicleId = getVehicleId(data);
        if (!vehicleId) return ack?.({ ok: false, error: '車両IDが指定されていません' });

        try {
          const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
          if (!vehicle) return ack?.({ ok: false, error: '車両が見つかりません' });
          if (vehicle.status !== VehicleStatus.ERROR) {
            return ack?.({ ok: false, error: 'この車両は緊急状態ではありません' });
          }

          await prisma.vehicle.update({
            where: { id: vehicleId },
            data: { status: VehicleStatus.IDLE },
          });

          this.broadcastVehicleUpdate({
            id: vehicleId,
            status: VehicleStatus.IDLE,
            emergencyReason: null,
          });

          await this.recordLog(vehicleId, LogLevel.INFO, `緊急状態を解除しました（操作: ${user.username}）`);
          ack?.({ ok: true });
        } catch (e) {
          console.error('緊急解除の処理エラー:', e);
          ack?.({ ok: false, error: '緊急状態の解除に失敗しました' });
        }
      });

      socket.on('disconnect', () => {
        console.log(`[WebSocket] クライアント切断: ${socket.id}`);
      });
    });
  }

  // ログをDBに保存して、フロントへ配信する
  private async recordLog(vehicleId: string, level: LogLevel, message: string) {
    const log = await prisma.vehicleLog.create({
      data: { vehicleId, logLevel: level, message },
    });
    this.broadcastLog({
      id: log.id.toString(),
      vehicleId,
      level,
      message,
      timestamp: log.timestamp.toISOString(),
    });
  }

  // 車両情報の更新をフロントエンドへブロードキャスト
  broadcastVehicleUpdate(vehicleUpdate: VehicleUpdatePayload) {
    if (this.io) {
      this.io.emit('vehicle:update', vehicleUpdate);
    }
  }

  // 通知・ログをフロントエンドへブロードキャスト
  broadcastLog(logPayload: LogPayload) {
    if (this.io) {
      this.io.emit('log:new', logPayload);
    }
  }

  // タスクに変化があったことを知らせる（フロントはこれを受けて一覧を取り直す）
  broadcastTasksChanged() {
    if (this.io) {
      this.io.emit('tasks:changed');
    }
  }
}

export const socketService = new SocketService();
