// src/services/socketService.ts
import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { VehicleUpdatePayload, LogPayload, SystemStatusPayload, TaskProgressPayload, VehiclePathPayload } from '../types';
import { mqttService } from './mqttService';
import { manualDriveService } from './manualDriveService';
import { vehicleCommandService } from './vehicleCommandService';
import { ACK_LOG_PREFIX, emergencyState } from './emergencyState';
import { prisma } from '../config/database';
import { VehicleStatus, LogLevel, Role } from '@prisma/client';
import { authenticate } from '../middleware/auth';
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
    manualDriveService.start((id, level, msg) => this.recordLog(id, level, msg));
    vehicleCommandService.start((id, level, msg) => this.recordLog(id, level, msg));

    // 接続時にトークンを確認する（フロントは io(url, { auth: { token } }) で送る）。
    // 削除されたユーザーはつながらない（画面はログイン画面に戻る）
    this.io.use((socket, next) => {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string') return next(new Error('unauthorized'));
      authenticate(token)
        .then((user) => {
          if (!user) return next(new Error('unauthorized'));
          socket.data.user = user;
          next();
        })
        .catch((e) => {
          console.error('[WebSocket] 認証エラー:', e);
          next(new Error('auth_failed'));
        });
    });

    this.io.on('connection', (socket: Socket) => {
      const user = socket.data.user as AuthUser;
      console.log(`[WebSocket] フロントエンド接続: ${socket.id} (${user.username})`);

      // つながった画面に、今のサーバーの接続状態を知らせる
      socket.emit('system:status', { mqtt: mqttService.isConnected() } satisfies SystemStatusPayload);

      // Web画面からの手動緊急停止指示
      socket.on('manual_emergency_stop', async (data: unknown, ack?: Ack) => {
        const vehicleId = getVehicleId(data);
        if (!vehicleId) return ack?.({ ok: false, error: '車両IDが指定されていません' });

        try {
          const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
          if (!vehicle) return ack?.({ ok: false, error: '車両が見つかりません' });

          console.warn(`[緊急] Webからの停止命令を受信: ${vehicleId} (${user.username})`);
          mqttService.sendEmergencyStop(vehicleId);
          manualDriveService.stopVehicle(vehicleId, '緊急停止');

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

      // Web画面の「確認」ボタン等による緊急状態の解除（ADMIN と OPERATOR だけ。緊急停止は安全のため VIEWER も押せる）
      socket.on('acknowledge_emergency', async (data: unknown, ack?: Ack) => {
        if (user.role === Role.VIEWER) return ack?.({ ok: false, error: '閲覧のみの権限では解除できません' });
        const vehicleId = getVehicleId(data);
        if (!vehicleId) return ack?.({ ok: false, error: '車両IDが指定されていません' });

        try {
          const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
          if (!vehicle) return ack?.({ ok: false, error: '車両が見つかりません' });
          if (vehicle.status !== VehicleStatus.ERROR) {
            return ack?.({ ok: false, error: 'この車両は緊急状態ではありません' });
          }

          // 車両（ラズパイ・PC1）にも解除を送る（docs/agv_protocol.md 2-1）
          // これを送らないと、Webで解除しても実機は止まったまま動かない
          mqttService.sendVehicleCommand(vehicleId, { action: 'CLEAR_EMERGENCY' });
          // 緊急停止など「解除が必要な原因」だけ忘れる（自己位置の喪失など、まだ続いている原因は残す）
          emergencyState.clearLatched(vehicleId);

          await prisma.vehicle.update({
            where: { id: vehicleId },
            data: { status: VehicleStatus.IDLE },
          });

          this.broadcastVehicleUpdate({
            id: vehicleId,
            status: VehicleStatus.IDLE,
            emergencyReason: null,
          });

          // 文言は emergencyState.ts の ACK_LOG_PREFIX と合わせる（再起動後に「解除済みか」をログから判断するため）
          await this.recordLog(vehicleId, LogLevel.INFO, `${ACK_LOG_PREFIX}（操作: ${user.username}）`);

          if (!mqttService.isConnected()) {
            return ack?.({
              ok: false,
              error: 'MQTTブローカーに接続されていないため、解除命令がまだ車両に届いていません',
            });
          }
          ack?.({ ok: true });
        } catch (e) {
          console.error('緊急解除の処理エラー:', e);
          ack?.({ ok: false, error: '緊急状態の解除に失敗しました' });
        }
      });

      // 運行操作（一時停止・再開、積み降ろし完了、地点へ移動、ホームへ戻る、現在地の設定）
      // data: { vehicleId, type, target? | x?, y?, theta? }
      socket.on('vehicle_command', async (data: unknown, ack?: Ack) => {
        try {
          ack?.(await vehicleCommandService.handle(user, data));
        } catch (e) {
          console.error('運行操作の処理エラー:', e);
          ack?.({ ok: false, error: '命令を送れませんでした' });
        }
      });

      // 手動操縦（WASD）。押している間、画面から 0.2 秒ごとに速度が届く
      socket.on('manual_drive', async (data: unknown, ack?: Ack) => {
        try {
          ack?.(await manualDriveService.drive(user, socket.id, data));
        } catch (e) {
          console.error('手動操縦の処理エラー:', e);
          ack?.({ ok: false, error: '手動操縦の命令を送れませんでした' });
        }
      });

      socket.on('disconnect', () => {
        console.log(`[WebSocket] クライアント切断: ${socket.id}`);
        manualDriveService.stopBySocket(socket.id); // 操縦中に画面が切れたら止める
      });
    });
  }

  // ログをDBに保存して、フロントへ配信する（他のサービスからも使う）
  async recordLog(vehicleId: string, level: LogLevel, message: string) {
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

  // サーバーの接続状態（MQTT など）が変わったことを知らせる
  broadcastSystemStatus(status: SystemStatusPayload) {
    if (this.io) {
      this.io.emit('system:status', status);
    }
  }

  // 車両の登録・削除があったことを知らせる（フロントはこれを受けて車両一覧を取り直す）
  broadcastVehiclesChanged() {
    if (this.io) {
      this.io.emit('vehicles:changed');
    }
  }

  // 運行の設定が変わったことを知らせる
  broadcastSettingsChanged(settings: { ops: { battWarn: number; battMin: number } }) {
    if (this.io) {
      this.io.emit('settings:changed', settings);
    }
  }

  // タスクに変化があったことを知らせる（フロントはこれを受けて一覧を取り直す）
  broadcastTasksChanged() {
    if (this.io) {
      this.io.emit('tasks:changed');
    }
  }

  // タスクの進捗（PC1 の agv/{id}/task）を知らせる。進捗バー用で、届くたびに送る
  broadcastTaskProgress(payload: TaskProgressPayload) {
    if (this.io) {
      this.io.emit('task:progress', payload);
    }
  }

  // Nav2 が計画した経路（PC1 の agv/{id}/path）を知らせる
  broadcastVehiclePath(payload: VehiclePathPayload) {
    if (this.io) {
      this.io.emit('vehicle:path', payload);
    }
  }

  // ユーザーの追加・変更・削除を知らせる（管理者の画面が一覧を取り直す）
  broadcastUsersChanged() {
    if (this.io) {
      this.io.emit('users:changed');
    }
  }

  // そのユーザーのリアルタイム接続を切る（削除・権限変更のあと）。
  // 画面は自動で再接続し、そのとき最新の権限で確認される。削除されていればログイン画面に戻る
  disconnectUser(userId: string) {
    if (!this.io) return;
    for (const s of this.io.sockets.sockets.values()) {
      if ((s.data.user as AuthUser | undefined)?.id === userId) s.disconnect(true);
    }
  }
}

export const socketService = new SocketService();
