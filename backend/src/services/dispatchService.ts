import { mqttService } from './mqttService';
import { socketService } from './socketService';
import { prisma } from '../config/database';
import { TaskStatus, VehicleStatus, LogLevel } from '@prisma/client';

class DispatchService {
  /**
   * 指定したタスクを車両に割り当てて配車指示を出す
   */
  async assignTask(taskId: string, vehicleId: string) {
    // 1. DB上のタスク情報および車両情報の更新（トランザクション処理）
    const [updatedTask, updatedVehicle] = await prisma.$transaction([
      prisma.task.update({
        where: { id: taskId },
        data: {
          assignedVehicleId: vehicleId,
          status: TaskStatus.ASSIGNED,
        },
      }),
      prisma.vehicle.update({
        where: { id: vehicleId },
        data: {
          status: VehicleStatus.RUNNING,
        },
      }),
      prisma.taskHistory.create({
        data: {
          taskId: taskId,
          status: TaskStatus.ASSIGNED,
          note: `車両 [${vehicleId}] にタスクが配車されました`,
        },
      }),
    ]);

    console.log(`タスク [${updatedTask.title}] を ${vehicleId} に配車しました`);

    // 2. 実機（Jetson/Pi）に向けてMQTT指示を送信
    mqttService.sendVehicleCommand(vehicleId, {
      type: 'TASK_ASSIGN',
      taskId: updatedTask.id,
      taskTitle: updatedTask.title,
      startLocation: updatedTask.startLocation,
      targetLocation: updatedTask.targetLocation,
    });

    // 3. フロントエンドへ状態変化をブロードキャスト
    socketService.broadcastVehicleUpdate({
      id: vehicleId,
      status: VehicleStatus.RUNNING,
      emergencyReason: null,
    });

    socketService.broadcastTasksChanged();

    // 4. DBへログ書き込み & フロントへ新着ログ配信
    const createdLog = await prisma.vehicleLog.create({
      data: {
        vehicleId: vehicleId,
        logLevel: LogLevel.INFO,
        message: `${vehicleId} にタスク [${updatedTask.title}] を割り当てました`,
      },
    });

    socketService.broadcastLog({
      id: createdLog.id.toString(),
      vehicleId: vehicleId,
      level: LogLevel.INFO,
      message: createdLog.message,
      timestamp: createdLog.timestamp.toISOString(),
    });

    return updatedTask;
  }
}

export const dispatchService = new DispatchService();