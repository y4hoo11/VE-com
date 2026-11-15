// services/taskProgressService.ts
// PC1 から届く agv/{id}/task（タスクの進捗）を DB（tasks / task_histories / vehicle_logs）と画面に反映する。
// 形は docs/agv_protocol.md 2-4: {"taskId":"…","status":"IN_PROGRESS","phase":"TO_START","progress":35,"message":"…"}
// これが無いと、実機のタスクは ASSIGNED のまま完了にならない（docs/backend_integration.md ②）
import { LogLevel, TaskStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { socketService } from './socketService';

type TaskProgressMessage = {
  taskId?: unknown;
  command?: unknown; // taskId が null のとき：GOTO / RETURN_HOME（タスクではない単発の移動）
  goal?: unknown;
  status?: unknown;
  phase?: unknown;
  progress?: unknown;
  message?: unknown;
};

const PHASES = ['TO_START', 'LOADING', 'TO_TARGET', 'UNLOADING'];
const FINISHED: TaskStatus[] = [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED];
const PHASE_LABEL: Record<string, string> = {
  TO_START: '出発地へ移動中',
  LOADING: '荷積み中',
  TO_TARGET: '目的地へ移動中',
  UNLOADING: '荷降ろし中',
};

class TaskProgressService {
  // taskId → "status:phase"（同じ内容を何度も DB に書かないため）
  private lastState = new Map<string, string>();

  async handle(vehicleId: string, msg: TaskProgressMessage) {
    const taskId = typeof msg.taskId === 'string' ? msg.taskId : '';
    if (!taskId) return this.handleMove(vehicleId, msg);
    const status = (Object.values(TaskStatus) as string[]).includes(String(msg.status)) ? (msg.status as TaskStatus) : TaskStatus.IN_PROGRESS;
    const phase = typeof msg.phase === 'string' && PHASES.includes(msg.phase) ? msg.phase : null;
    const progress = typeof msg.progress === 'number' && Number.isFinite(msg.progress) ? Math.max(0, Math.min(100, msg.progress)) : null;
    const text = typeof msg.message === 'string' ? msg.message : '';

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return; // DB に無いタスク（テスト用に送ったものなど）は無視
    if (task.assignedVehicleId !== vehicleId) {
      console.warn(`[タスク進捗] ${taskId} は ${vehicleId} に割り当てられていないため無視しました`);
      return;
    }
    // 終わったタスク（Web で中止したものなど）を、遅れて届いた進捗で戻さない
    if (FINISHED.includes(task.status)) return;

    // 画面には毎回送る（進捗バー用）
    socketService.broadcastTaskProgress({ taskId, vehicleId, status, phase, progress, message: text });

    const key = `${status}:${phase ?? ''}`;
    if (this.lastState.get(taskId) === key) return; // 状態が変わったときだけ DB に書く
    this.lastState.set(taskId, key);

    const finished = FINISHED.includes(status);
    await prisma.task.update({
      where: { id: taskId },
      data: {
        status,
        ...(status === TaskStatus.IN_PROGRESS && !task.startedAt ? { startedAt: new Date() } : {}),
        ...(finished ? { completedAt: new Date() } : {}),
      },
    });
    const note = [phase ? PHASE_LABEL[phase] : '', text].filter(Boolean).join('：') || null;
    await prisma.taskHistory.create({ data: { taskId, status, note } });

    const level = status === TaskStatus.FAILED ? LogLevel.ERROR : LogLevel.INFO;
    const label =
      status === TaskStatus.COMPLETED ? '完了しました' : status === TaskStatus.FAILED ? '失敗しました' : status === TaskStatus.CANCELLED ? '中止されました' : (phase && PHASE_LABEL[phase]) || '進行中';
    await socketService.recordLog(vehicleId, level, `タスク「${task.title}」: ${label}${text ? `（${text}）` : ''}`);

    socketService.broadcastTasksChanged();
    if (finished) this.lastState.delete(taskId);
  }

  /**
   * GOTO / RETURN_HOME（タスクではない単発の移動）の結果。taskId が null で届く（docs/agv_protocol.md 2-4）。
   * DB のタスクとは結び付けず、終わったとき（完了・失敗）だけログに残す（失敗は ERROR なので画面のお知らせにも出る）
   */
  private async handleMove(vehicleId: string, msg: TaskProgressMessage) {
    const command = msg.command === 'RETURN_HOME' ? 'ホームへ戻る' : msg.command === 'GOTO' ? '地点へ移動' : null;
    if (!command) return;
    const goal = typeof msg.goal === 'string' && msg.goal ? msg.goal : '';
    const text = typeof msg.message === 'string' ? msg.message : '';
    if (msg.status === TaskStatus.FAILED) {
      await socketService.recordLog(vehicleId, LogLevel.ERROR, `${command}（${goal || '行き先不明'}）に失敗しました${text ? `：${text}` : ''}`);
    } else if (msg.status === TaskStatus.COMPLETED) {
      await socketService.recordLog(vehicleId, LogLevel.INFO, `${command}（${goal}）が完了しました`);
    }
  }
}

export const taskProgressService = new TaskProgressService();
