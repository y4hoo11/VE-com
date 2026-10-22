// src/services/socketService.ts
import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { VehicleUpdatePayload, LogPayload } from '../types';
import { mqttService } from './mqttService';
import { prisma } from '../config/database';
import { VehicleStatus } from '@prisma/client';
import { verifyToken } from '../middleware/auth';

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
      console.log(`[WebSocket] フロントエンド接続: ${socket.id}`);

      // Web画面からの手動緊急停止指示
      socket.on('manual_emergency_stop', (data: { vehicleId: string }) => {
        console.warn(`[緊急] Webからの停止命令を受信: ${data.vehicleId}`);
        mqttService.sendEmergencyStop(data.vehicleId);
      });

      // Web画面の「確認」ボタン等による緊急状態の解除
      socket.on('acknowledge_emergency', async (data: { vehicleId: string }) => {
        await prisma.vehicle.update({
          where: { id: data.vehicleId },
          data: { status: VehicleStatus.IDLE },
        });

        this.broadcastVehicleUpdate({
          id: data.vehicleId,
          status: VehicleStatus.IDLE,
          emergencyReason: null,
        });
      });

      socket.on('disconnect', () => {
        console.log(`[WebSocket] クライアント切断: ${socket.id}`);
      });
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
}

export const socketService = new SocketService();