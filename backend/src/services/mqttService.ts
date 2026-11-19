import { mqttClient } from '../config/mqtt';
import { socketService } from './socketService';
import { prisma } from '../config/database';
import { VehicleStatus, LogLevel } from '@prisma/client';
import { CLEARANCE_KEYS, type VehicleClearancePayload, type VehicleTelemetryExtra } from '../types';
import { taskProgressService } from './taskProgressService';
import { emergencyState } from './emergencyState';

// 受信するトピック（docs/agv_protocol.md 2-2〜2-6）
const TOPICS = ['agv/+/telemetry', 'agv/+/emergency', 'agv/+/task', 'agv/+/path', 'agv/+/online', 'agv/+/clearance'];

// agv/{id}/path の points（[[x,y],...]）を画面の形にする。おかしな値は捨てる
function readPath(m: Record<string, unknown>) {
  const points = Array.isArray(m.points)
    ? m.points
        .filter((p): p is [number, number] => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
        .map(([x, y]) => ({ x, y }))
    : [];
  const g = m.goal as { x?: unknown; y?: unknown } | undefined;
  const goal = g && typeof g.x === 'number' && typeof g.y === 'number' ? { x: g.x, y: g.y } : null;
  return { points, goal };
}

// agv/{id}/clearance（8 方向の距離 [cm]）を画面の形にする。数でない値は null（物が見えない）にする
function readClearance(m: Record<string, unknown>): Omit<VehicleClearancePayload, 'id'> {
  const src = (m.sectors ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  const sectors = Object.fromEntries(CLEARANCE_KEYS.map((k) => [k, num(src[k])])) as VehicleClearancePayload['sectors'];
  const values = Object.values(sectors).filter((v): v is number => v !== null);
  return { sectors, nearest: values.length ? Math.min(...values) : null };
}

// telemetry の追加項目のうち、画面にそのまま流すもの（型が合うものだけ通す）
const NUM_KEYS = ['speed', 'locQuality', 'piTemp', 'lidarHz', 'vbat'] as const;
const STR_KEYS = ['phase', 'goal', 'taskId', 'mode', 'note'] as const;

function pickTelemetryExtra(m: Record<string, unknown>): VehicleTelemetryExtra | undefined {
  const out: Record<string, unknown> = {};
  for (const k of NUM_KEYS) if (typeof m[k] === 'number') out[k] = m[k];
  // ROS は「無し」を null で送る（タスクが終わったときの goal・phase・taskId など）。
  // 捨てると前の値が画面に残り続けるので、空文字にして「消す」と伝える
  for (const k of STR_KEYS) {
    if (typeof m[k] === 'string') out[k] = m[k];
    else if (m[k] === null) out[k] = '';
  }
  if (typeof m.esp32 === 'boolean') out.esp32 = m.esp32;
  if (typeof m.paused === 'boolean') out.paused = m.paused;
  // 障害物までの距離（8 方向の LiDAR と、前の超音波）。数でないもの（未接続・点なし）は null にする
  const dist = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null);
  if (Array.isArray(m.scan8) && m.scan8.length === 8) out.scan8 = m.scan8.map(dist);
  if ('usFront' in m) out.usFront = dist(m.usFront);
  return Object.keys(out).length ? (out as VehicleTelemetryExtra) : undefined;
}

class MqttService {
  // 車両ID → やりかけの移動（タスク・地点へ移動・待ち行列）があるか。PC1 の telemetry から覚える
  private pendingMove = new Map<string, boolean>();

  /**
   * その車両に、やりかけの移動があるか。まだ分からない（telemetry を受け取っていない）ときは null。
   * 緊急停止を解除するとき、解除したとたんに続きを走り出さないようにするために使う
   */
  hasPendingMove(agvId: string): boolean | null {
    return this.pendingMove.get(agvId) ?? null;
  }

  init() {
    const subscribeTopics = () => {
      mqttClient.subscribe(TOPICS, undefined, (err: Error | null) => {
        if (!err) {
          console.log(`[MQTT] 購読開始: ${TOPICS.join(', ')}`);
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
          // PC1（mission_manager）の telemetry には taskId・goal・queued が入っている（ラズパイの分には無い）
          if ('taskId' in message || 'goal' in message) {
            this.pendingMove.set(agvId, !!message.taskId || !!message.goal || Number(message.queued) > 0);
          }
          // オフラインだった車両から telemetry が届いたら、オンラインに戻す
          // （status を送らない送り手（ラズパイ）からでも戻れるよう、無ければ IDLE にする）
          const prev = await prisma.vehicle.findUnique({ where: { id: agvId }, select: { status: true } });
          const sentStatus = Object.values(VehicleStatus).includes(message.status) ? (message.status as VehicleStatus) : undefined;
          const backOnline = prev?.status === VehicleStatus.OFFLINE && sentStatus !== VehicleStatus.OFFLINE;
          const nextStatus = sentStatus ?? (backOnline ? VehicleStatus.IDLE : undefined);
          // PC1 が ERROR 以外を送ってきた = 異常の原因が消えた（ラッチしない異常から自動で戻った）
          if (sentStatus && sentStatus !== VehicleStatus.ERROR) emergencyState.clear(agvId);

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
          emergencyState.record(agvId, message.code);

          // まだ DB に無い車両（telemetry より先に emergency が届いた）は記録できないので飛ばす
          const r = await prisma.vehicle.updateMany({
            where: { id: agvId },
            data: { status: VehicleStatus.ERROR },
          });
          if (r.count === 0) {
            console.warn(`[MQTT緊急検知] 未登録の車両 ${agvId} からの緊急停止のため、記録しませんでした`);
            return;
          }

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
        } else if (topic.endsWith('/task')) {
          // タスクの進捗（docs/agv_protocol.md 2-4）
          await taskProgressService.handle(agvId, message);
        } else if (topic.endsWith('/clearance')) {
          // LiDAR で見えている物の 8 方向の距離（2-7）。DB には保存せず、画面に流すだけ
          socketService.broadcastVehicleClearance({ id: agvId, ...readClearance(message) });
        } else if (topic.endsWith('/path')) {
          // Nav2 が計画した経路（2-5）。DB には保存せず、画面に流すだけ
          socketService.broadcastVehiclePath({ id: agvId, ...readPath(message) });
        } else if (topic.endsWith('/online')) {
          // PC1 の接続状態（2-6）。切れたとき（遺言）は、5秒待たずにすぐオフラインにする。
          // つながったときは何もしない（telemetry が届いた時点でオンラインに戻る）
          if (message.online !== false) return;
          const r = await prisma.vehicle.updateMany({
            where: { id: agvId, status: { notIn: [VehicleStatus.OFFLINE, VehicleStatus.ERROR] } },
            data: { status: VehicleStatus.OFFLINE },
          });
          if (r.count > 0) {
            socketService.broadcastVehicleUpdate({ id: agvId, status: VehicleStatus.OFFLINE });
            await socketService.recordLog(agvId, LogLevel.WARN, 'PC1 との接続が切れたため、オフラインにしました');
          }
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
    emergencyState.recordWebEstop(agvId);
    console.warn(`[MQTT送信] ${agvId} に緊急停止コマンドを発行しました`);
  }
}

export const mqttService = new MqttService();
