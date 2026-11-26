import { mqttService } from './mqttService';
import { socketService } from './socketService';
import { prisma } from '../config/database';
import { TaskStatus, VehicleStatus, LogLevel, type Task } from '@prisma/client';

export type AssignSource = 'manual' | 'auto';

/** 割り当てできなかったとき（別の割り当て・中止と同時に起きた） */
export class AssignConflictError extends Error {}

class DispatchService {
  /**
   * 指定したタスクを車両に割り当てて配車指示を出す。
   * 手動の割り当てと自動割り当てが同時に走っても、1つのタスクに2台・1台に2タスクにならないように、
   * 車両の行をロックしてから「タスクが PENDING のまま」「車両が他のタスクを持っていない」ときだけ書き換える。
   * 間に合わなかったら AssignConflictError
   */
  async assignTask(taskId: string, vehicleId: string, opts: { source?: AssignSource; reason?: string } = {}): Promise<Task> {
    const source = opts.source ?? 'manual';
    const how = source === 'auto' ? '自動割り当て' : '割り当て';
    const why = opts.reason ? `（${opts.reason}）` : '';

    // 1. DB上のタスク情報および車両情報の更新（トランザクション処理）
    const updatedTask = await prisma.$transaction(async (tx) => {
      // 同じ車両への割り当てを1つずつにする（このトランザクションが終わるまで、ほかは待つ）
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM vehicles WHERE id = ${vehicleId} FOR UPDATE`;
      if (locked.length === 0) throw new AssignConflictError('車両が見つかりません');

      const busy = await tx.task.count({
        where: { assignedVehicleId: vehicleId, status: { in: [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS] } },
      });
      if (busy > 0) throw new AssignConflictError('この車両は別のタスクを実行中です');

      // まだ PENDING のときだけ（その間に中止・ほかの車両へ割り当てられていたら 0 件）
      const r = await tx.task.updateMany({
        where: { id: taskId, status: TaskStatus.PENDING },
        data: { assignedVehicleId: vehicleId, status: TaskStatus.ASSIGNED },
      });
      if (r.count === 0) throw new AssignConflictError('このタスクは割り当て待ちではありません');

      await tx.vehicle.update({ where: { id: vehicleId }, data: { status: VehicleStatus.RUNNING } });
      await tx.taskHistory.create({
        data: {
          taskId,
          status: TaskStatus.ASSIGNED,
          note: `${how}: 車両 [${vehicleId}] にタスクが配車されました${why}`,
        },
      });
      return tx.task.findUniqueOrThrow({ where: { id: taskId } });
    });

    console.log(`[${how}] タスク [${updatedTask.title}] を ${vehicleId} に配車しました${why}`);

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
    await socketService.recordLog(vehicleId, LogLevel.INFO, `${vehicleId} にタスク [${updatedTask.title}] を${source === 'auto' ? '自動で' : ''}割り当てました${why}`);

    return updatedTask;
  }
}

export const dispatchService = new DispatchService();
