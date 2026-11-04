import { mqttClient } from '../config/mqtt';
import { socketService } from './socketService';
import { prisma } from '../config/database';
import { VehicleStatus, LogLevel } from '@prisma/client';
import type { VehicleTelemetryExtra } from '../types';

// telemetry の追加項目のうち、画面にそのまま流すもの（型が合うものだけ通す）
const NUM_KEYS = ['speed', 'locQuality', 'piTemp', 'lidarHz', 'vbat'] as const;
const STR_KEYS = ['phase', 'goal', 'taskId', 'mode', 'note'] as const;

function pickTelemetryExtra(m: Record<string, unknown>): VehicleTelemetryExtra | undefined {
  const out: Record<string, unknown> = {};
  for (const k of NUM_KEYS) if (typeof m[k] === 'number') out[k] = m[k];
  for (const k of STR_KEYS) if (typeof m[k] === 'string') out[k] = m[k];
  if (typeof m.esp32 === 'boolean') out.esp32 = m.esp32;
  return Object.keys(out).length ? (out as VehicleTelemetryExtra) : undefined;
}

class MqttService {
  init() {
    const subscribeTopics = () => {
      mqttClient.subscribe(['agv/+/telemetry', 'agv/+/emergency'], undefined, (err: Error | null) => {
        if (!err) {
          console.log('[MQTT] 購読開始: agv/+/telemetry, agv/+/emergency');
        } else {
          console.error('[MQTT] 購読エラー:', err);
        }
      });
    };

    // 接続（再接続を含む）のたびに購読する
    // 起動直後の接続に失敗しても、つながった時点で必ず購読される
    mqttClient.on('connect', subscribeTopics);
    if (mqttClient.connected) subscribeTopics();

    // 接続・切断を画面に知らせる（ヘッダーの「接続中 / MQTT切断」とお知らせ帯）
    let lastConnected: boolean | null = null;
    const notifyStatus = () => {
      const connected = mqttClient.connected;
      if (connected === lastConnected) return;
      lastConnected = connected;
      socketService.broadcastSystemStatus({ mqtt: connected });
    };
    mqttClient.on('connect', notifyStatus);
    mqttClient.on('close', notifyStatus);
    mqttClient.on('offline', notifyStatus);

    mqttClient.on('message', async (topic, payload) => {
      try {
        const message = JSON.parse(payload.toString());
        const topicParts = topic.split('/');
        const agvId = topicParts[1];

        if (topic.endsWith('/telemetry')) {
          // オフラインだった車両から telemetry が届いたら、オンラインに戻す
          // （status を送らない送り手（ラズパイ）からでも戻れるよう、無ければ IDLE にする）
          const prev = await prisma.vehicle.findUnique({ where: { id: agvId }, select: { status: true } });
          const sentStatus = Object.values(VehicleStatus).includes(message.status) ? (message.status as VehicleStatus) : undefined;
          const backOnline = prev?.status === VehicleStatus.OFFLINE && sentStatus !== VehicleStatus.OFFLINE;
          const nextStatus = sentStatus ?? (backOnline ? VehicleStatus.IDLE : undefined);

          // 1. テレメトリ受信: DBのVehicle状態を更新 (upsert)
          const updatedVehicle = await prisma.vehicle.upsert({
            where: { id: agvId },
            update: {
              batteryLevel: typeof message.battery === 'number' ? message.battery : undefined,
              status: nextStatus,
              currentX: typeof message.x === 'number' ? message.x : undefined,
              currentY: typeof message.y === 'number' ? message.y : undefined,
              currentTheta: typeof message.theta === 'number' ? message.theta : undefined,
              currentMapId: message.mapId || undefined,
              lastHeartbeat: new Date(),
            },
            create: {
              id: agvId,
              name: message.name || agvId,
              batteryLevel: typeof message.battery === 'number' ? message.battery : 100,
              status: (message.status as VehicleStatus) || VehicleStatus.IDLE,
              currentX: message.x || 0,
              currentY: message.y || 0,
              currentTheta: message.theta || 0,
              currentMapId: message.mapId || null,
              lastHeartbeat: new Date(),
            },
          });

          // 2. フロントエンドへ最新車両状態をブロードキャスト
          socketService.broadcastVehicleUpdate({
            id: updatedVehicle.id,
            status: updatedVehicle.status,
            batteryLevel: updatedVehicle.batteryLevel,
            currentX: updatedVehicle.currentX,
            currentY: updatedVehicle.currentY,
            currentTheta: updatedVehicle.currentTheta,
            telemetry: pickTelemetryExtra(message),
          });

          if (backOnline) {
            await socketService.recordLog(agvId, LogLevel.INFO, '通信が戻ったため、オンラインに戻しました');
          }

        } else if (topic.endsWith('/emergency')) {
          const reason = message.reason || '障害物接近による緊急制動';
          console.error(`[MQTT緊急検知] ${agvId}: ${reason}`);

          await prisma.vehicle.update({
            where: { id: agvId },
            data: { status: VehicleStatus.ERROR },
          });

          const createdLog = await prisma.vehicleLog.create({
            data: {
              vehicleId: agvId,
              logLevel: LogLevel.ERROR,
              message: `緊急停止: ${reason}`,
              details: message,
            },
          });

          socketService.broadcastVehicleUpdate({
            id: agvId,
            status: VehicleStatus.ERROR,
            emergencyReason: reason,
            emergencyCode: typeof message.code === 'string' ? message.code : null,
            emergencySource: typeof message.source === 'string' ? message.source : null,
          });

          socketService.broadcastLog({
            id: createdLog.id.toString(),
            vehicleId: agvId,
            level: LogLevel.ERROR,
            message: createdLog.message, // DBに保存した内容と同じ文言にそろえる
            details: message,
            timestamp: createdLog.timestamp.toISOString(),
          });
        }
      } catch (e) {
        console.error('MQTTメッセージの処理エラー:', e);
      }
    });
  }

  sendVehicleCommand(agvId: string, command: object) {
    const topic = `agv/${agvId}/command`;
    mqttClient.publish(topic, JSON.stringify(command));
    console.log(`[MQTT送信] ${topic}:`, command);
  }

  // MQTTブローカーにつながっているか
  isConnected() {
    return mqttClient.connected;
  }

  sendEmergencyStop(agvId: string) {
    const topic = `agv/${agvId}/command`;
    mqttClient.publish(topic, JSON.stringify({ action: 'EMERGENCY_STOP' }));
    console.warn(`[MQTT送信] ${agvId} に緊急停止コマンドを発行しました`);
  }
}

export const mqttService = new MqttService();
