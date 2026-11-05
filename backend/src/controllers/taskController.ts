// controllers/taskController.ts
import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { dispatchService } from '../services/dispatchService';
import { socketService } from '../services/socketService';
import { mqttService } from '../services/mqttService';
import { TaskStatus, VehicleStatus, LogLevel } from '@prisma/client';
import { loadOpsSettings } from './settingsController';
 
// ヘルパー関数: string | string[] から安全に単一の string を取り出す
const getStringParam = (param: unknown): string | undefined => {
  if (typeof param === 'string') return param;
  if (Array.isArray(param) && typeof param[0] === 'string') return param[0];
  return undefined;
};
 
// 優先度は 1(Low) ~ 5(High) に丸める
const normalizePriority = (value: unknown): number => {
  const parsed =
    typeof value === 'number' ? value : parseInt(getStringParam(value) || '3', 10);
  if (Number.isNaN(parsed)) return 3;
  return Math.min(5, Math.max(1, Math.trunc(parsed)));
};
 
export const getTasks = async (req: Request, res: Response) => {
  try {
    // 既定ではキャンセル済み(論理削除)を除外する。履歴用途は ?includeCancelled=true
    const includeCancelled = getStringParam(req.query.includeCancelled) === 'true';
    // ?view=active … 進行中（未配車・配車済み・実行中）だけ
    // ?view=done   … 終わったもの（完了・失敗・キャンセル）だけ。終わった日時の新しい順
    const view = getStringParam(req.query.view);

    const ACTIVE: TaskStatus[] = [TaskStatus.PENDING, TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS];
    const DONE: TaskStatus[] = [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED];

    const where =
      view === 'active'
        ? { status: { in: ACTIVE } }
        : view === 'done'
          ? { status: { in: DONE } }
          : includeCancelled
            ? undefined
            : { status: { not: TaskStatus.CANCELLED } };

    const orderBy =
      view === 'done'
        ? [{ completedAt: { sort: 'desc' as const, nulls: 'last' as const } }, { updatedAt: 'desc' as const }]
        : [{ createdAt: 'desc' as const }];

    const tasks = await prisma.task.findMany({
      where,
      orderBy,
      // 完了タブは件数が増え続けるので、新しい100件までにする
      ...(view === 'done' ? { take: 100 } : {}),
      include: {
        assignedVehicle: true,
        createdByUser: {
          select: { id: true, username: true, email: true },
        },
      },
    });
    res.json(tasks);
  } catch (error) {
    console.error('タスク一覧取得エラー:', error);
    res.status(500).json({ error: 'タスク一覧の取得に失敗しました' });
  }
};
 
export const createTask = async (req: Request, res: Response) => {
  try {
    const { title, name, startLocation, targetLocation, priority, scheduledAt, createdByUserId } =
      req.body ?? {};
 
    const taskTitle = getStringParam(title) || getStringParam(name);
    const sLocation = getStringParam(startLocation);
    const tLocation = getStringParam(targetLocation);
    // ログイン中のユーザーを優先する（bodyの値は書き換えられるので信用しない）
    const rawUserId = req.user?.id || getStringParam(createdByUserId);
 
    if (!taskTitle) {
      return res.status(400).json({ error: 'タスクタイトル (title) は必須です' });
    }
 
    // 作成者IDは実在確認してから使う（存在しないIDだと外部キー違反で500になるため）
    let userId: string | null = null;
    if (rawUserId) {
      const user = await prisma.user.findUnique({
        where: { id: rawUserId },
        select: { id: true },
      });
      userId = user?.id ?? null;
    }
 
    const parsedScheduledAt = scheduledAt ? new Date(String(scheduledAt)) : null;
    const validScheduledAt =
      parsedScheduledAt && !Number.isNaN(parsedScheduledAt.getTime()) ? parsedScheduledAt : null;
 
    // トランザクションでタスク作成と履歴記録をアトミックに実行
    const result = await prisma.$transaction(async (tx) => {
      const newTask = await tx.task.create({
        data: {
          title: taskTitle,
          startLocation: sLocation,
          targetLocation: tLocation,
          priority: normalizePriority(priority),
          scheduledAt: validScheduledAt,
          createdByUserId: userId,
          status: TaskStatus.PENDING,
        },
      });
 
      // タスク作成時の履歴を追加
      await tx.taskHistory.create({
        data: {
          taskId: newTask.id,
          status: TaskStatus.PENDING,
          note: `タスクが作成されました (ユーザーID: ${userId || '不明'})`,
        },
      });
 
      return newTask;
    });
 
    socketService.broadcastTasksChanged();
    res.status(201).json(result);
  } catch (error) {
    console.error('タスク作成エラー:', error);
    res.status(500).json({ error: 'タスクの作成に失敗しました' });
  }
};
 
export const deleteTask = async (req: Request, res: Response) => {
  try {
    const taskId = getStringParam(req.params.id);
    const userId = req.user?.id || getStringParam(req.body?.userId) || getStringParam(req.query?.userId);
    const actorName = req.user?.username || userId || '不明';

    if (!taskId) {
      return res.status(400).json({ error: 'タスクIDは必須です' });
    }

    const outcome = await prisma.$transaction(async (tx) => {
      const task = await tx.task.findUnique({ where: { id: taskId } });

      if (!task) return { kind: 'not_found' as const };
      // 二重実行で completedAt の上書きや履歴の重複が起きないようにする
      if (
        task.status === TaskStatus.CANCELLED ||
        task.status === TaskStatus.COMPLETED ||
        task.status === TaskStatus.FAILED
      ) {
        return { kind: 'already_done' as const };
      }

      // 配車済み・実行中なら「中止」。車両に CANCEL_TASK を送る（docs/agv_protocol.md 2-1）
      const running = task.status === TaskStatus.ASSIGNED || task.status === TaskStatus.IN_PROGRESS;
      const vehicleId = running ? task.assignedVehicleId : null;

      await tx.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.CANCELLED,
          completedAt: new Date(), // キャンセル日時
        },
      });

      await tx.taskHistory.create({
        data: {
          taskId: task.id,
          status: TaskStatus.CANCELLED,
          note: running
            ? `タスク「${task.title}」を中止しました（CANCEL_TASK, 操作: ${actorName}）`
            : `タスク「${task.title}」がキャンセルされました（操作: ${actorName}）`,
        },
      });

      // 車両に他の進行中タスクがなく、異常でもなければ待機に戻す
      let releasedVehicle = false;
      if (vehicleId) {
        const remaining = await tx.task.count({
          where: {
            assignedVehicleId: vehicleId,
            id: { not: task.id },
            status: { in: [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS] },
          },
        });
        const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId } });
        if (remaining === 0 && vehicle && vehicle.status !== VehicleStatus.ERROR && vehicle.status !== VehicleStatus.OFFLINE) {
          await tx.vehicle.update({ where: { id: vehicleId }, data: { status: VehicleStatus.IDLE } });
          releasedVehicle = true;
        }
      }

      return { kind: 'ok' as const, task, vehicleId, releasedVehicle };
    });

    if (outcome.kind === 'not_found') {
      return res.status(404).json({ error: 'タスクが見つかりません' });
    }
    if (outcome.kind === 'already_done') {
      return res.status(409).json({ error: '既に完了・失敗・キャンセル済みのタスクです' });
    }

    let warning: string | undefined;
    if (outcome.vehicleId) {
      mqttService.sendVehicleCommand(outcome.vehicleId, { action: 'CANCEL_TASK', taskId: outcome.task.id });
      await socketService.recordLog(
        outcome.vehicleId,
        LogLevel.WARN,
        `タスク [${outcome.task.title}] を中止しました（CANCEL_TASK, 操作: ${actorName}）`,
      );
      if (outcome.releasedVehicle) {
        socketService.broadcastVehicleUpdate({ id: outcome.vehicleId, status: VehicleStatus.IDLE });
      }
      if (!mqttService.isConnected()) {
        warning = 'MQTTブローカーに接続されていないため、中止の命令がまだ車両に届いていません';
      }
    }

    socketService.broadcastTasksChanged();
    res.status(200).json({
      message: outcome.vehicleId ? 'タスクを中止しました' : 'タスクをキャンセル（削除）しました',
      ...(warning ? { warning } : {}),
    });
  } catch (error) {
    console.error('タスク削除エラー:', error);
    // 内部エラーの詳細はクライアントに返さない
    res.status(500).json({ error: 'タスクの削除に失敗しました' });
  }
};

/**
 * GET /api/tasks/:id
 * タスク1件と、その状態の変化の履歴（古い順）を返す
 */
export const getTaskById = async (req: Request, res: Response) => {
  try {
    const taskId = getStringParam(req.params.id);
    if (!taskId) return res.status(400).json({ error: 'タスクIDは必須です' });

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignedVehicle: true,
        createdByUser: { select: { id: true, username: true, email: true } },
        histories: { orderBy: { timestamp: 'asc' } },
      },
    });
    if (!task) return res.status(404).json({ error: 'タスクが見つかりません' });

    // 履歴の id は BigInt なので文字列にする
    res.json({ ...task, histories: task.histories.map((h) => ({ ...h, id: h.id.toString() })) });
  } catch (error) {
    console.error('タスク取得エラー:', error);
    res.status(500).json({ error: 'タスクの取得に失敗しました' });
  }
};
 
export const assignTask = async (req: Request, res: Response) => {
  try {
    const { taskId, vehicleId } = req.body ?? {};
    const tId = getStringParam(taskId);
    const vId = getStringParam(vehicleId);
 
    if (!tId || !vId) {
      return res.status(400).json({ error: 'taskId と vehicleId は必須です' });
    }
 
    // 割り当てる前に、タスクと車両の状態を確かめる（画面の候補と同じ条件）
    const [t, v, ops] = await Promise.all([
      prisma.task.findUnique({ where: { id: tId } }),
      prisma.vehicle.findUnique({ where: { id: vId } }),
      loadOpsSettings(),
    ]);
    if (!t) return res.status(404).json({ error: 'タスクが見つかりません' });
    if (!v) return res.status(404).json({ error: '車両が見つかりません' });
    if (t.status !== TaskStatus.PENDING) {
      return res.status(409).json({ error: 'このタスクは割り当て待ちではありません' });
    }
    if (v.status === VehicleStatus.OFFLINE) {
      return res.status(409).json({ error: 'この車両はオフラインのため割り当てられません' });
    }
    if (v.status === VehicleStatus.ERROR) {
      return res.status(409).json({ error: 'この車両は異常中のため割り当てられません' });
    }
    const busy = await prisma.task.count({
      where: { assignedVehicleId: vId, status: { in: [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS] } },
    });
    if (busy > 0) {
      return res.status(409).json({ error: 'この車両は別のタスクを実行中です' });
    }
    if (v.batteryLevel < ops.battMin) {
      return res.status(409).json({ error: `電池残量が ${ops.battMin}% 未満のため割り当てられません` });
    }

    const updatedTask = await dispatchService.assignTask(tId, vId);
    res.json(updatedTask);
  } catch (error) {
    console.error('配車処理エラー:', error);
    res.status(500).json({ error: '配車処理に失敗しました' });
  }
};
 
// ステータスの手動変更で許可する遷移
// PENDING → ASSIGNED は配車API、→ CANCELLED は削除APIで行うため、ここでは扱わない
const ALLOWED_STATUS_TRANSITIONS: Partial<Record<TaskStatus, TaskStatus[]>> = {
  [TaskStatus.ASSIGNED]: [TaskStatus.IN_PROGRESS, TaskStatus.FAILED],
  [TaskStatus.IN_PROGRESS]: [TaskStatus.COMPLETED, TaskStatus.FAILED],
};

// 終了扱いのステータス（車両を解放する）
const FINISHED_STATUSES: TaskStatus[] = [TaskStatus.COMPLETED, TaskStatus.FAILED];

export const updateTask = async (req: Request, res: Response) => {
  try {
    const taskId = getStringParam(req.params.id);
    if (!taskId) {
      return res.status(400).json({ error: 'タスクIDは必須です' });
    }

    const { title, priority, startLocation, targetLocation, scheduledAt, status, userId } =
      req.body ?? {};

    // 内容の変更項目（指定されたものだけ更新する）
    const contentData: {
      title?: string;
      priority?: number;
      startLocation?: string | null;
      targetLocation?: string | null;
      scheduledAt?: Date | null;
    } = {};

    if (title !== undefined) {
      const t = getStringParam(title)?.trim();
      if (!t) return res.status(400).json({ error: 'タイトルを空にはできません' });
      contentData.title = t;
    }
    if (priority !== undefined) contentData.priority = normalizePriority(priority);
    if (startLocation !== undefined) contentData.startLocation = getStringParam(startLocation) ?? null;
    if (targetLocation !== undefined) contentData.targetLocation = getStringParam(targetLocation) ?? null;
    if (scheduledAt !== undefined) {
      if (scheduledAt === null || scheduledAt === '') {
        contentData.scheduledAt = null;
      } else {
        const d = new Date(String(scheduledAt));
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ error: '期限 (scheduledAt) の形式が不正です' });
        }
        contentData.scheduledAt = d;
      }
    }

    let nextStatus: TaskStatus | undefined;
    if (status !== undefined) {
      const s = getStringParam(status);
      if (!s || !Object.values(TaskStatus).includes(s as TaskStatus)) {
        return res.status(400).json({ error: '不正なステータスです' });
      }
      nextStatus = s as TaskStatus;
    }

    const hasContentChange = Object.keys(contentData).length > 0;
    if (!hasContentChange && !nextStatus) {
      return res.status(400).json({ error: '更新する項目がありません' });
    }

    const outcome = await prisma.$transaction(async (tx) => {
      const task = await tx.task.findUnique({ where: { id: taskId } });
      if (!task) return { kind: 'not_found' as const };

      // 内容の編集は、まだ車両に渡していない PENDING のときだけ許可
      if (hasContentChange && task.status !== TaskStatus.PENDING) {
        return { kind: 'locked' as const };
      }

      const statusChanged = nextStatus !== undefined && nextStatus !== task.status;
      if (statusChanged && !(ALLOWED_STATUS_TRANSITIONS[task.status] ?? []).includes(nextStatus!)) {
        return { kind: 'bad_transition' as const, from: task.status, to: nextStatus! };
      }

      const now = new Date();
      const updated = await tx.task.update({
        where: { id: taskId },
        data: {
          ...contentData,
          ...(statusChanged
            ? {
                status: nextStatus,
                ...(nextStatus === TaskStatus.IN_PROGRESS && !task.startedAt ? { startedAt: now } : {}),
                ...(FINISHED_STATUSES.includes(nextStatus!) ? { completedAt: now } : {}),
              }
            : {}),
        },
      });

      const actor = req.user?.id || getStringParam(userId) || '不明';
      let releasedVehicleId: string | null = null;
      if (statusChanged) {
        await tx.taskHistory.create({
          data: {
            taskId: task.id,
            status: nextStatus!,
            note: `ステータスを ${task.status} → ${nextStatus} に変更しました (実行ユーザーID: ${actor})`,
          },
        });

        // タスクが終わったら、担当車両に他の進行中タスクがなければ IDLE に戻す
        if (FINISHED_STATUSES.includes(nextStatus!) && task.assignedVehicleId) {
          const remaining = await tx.task.count({
            where: {
              assignedVehicleId: task.assignedVehicleId,
              id: { not: task.id },
              status: { in: [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS] },
            },
          });
          if (remaining === 0) {
            await tx.vehicle.update({
              where: { id: task.assignedVehicleId },
              data: { status: VehicleStatus.IDLE },
            });
            releasedVehicleId = task.assignedVehicleId;
          }
        }
      } else if (hasContentChange) {
        await tx.taskHistory.create({
          data: {
            taskId: task.id,
            status: task.status,
            note: `タスク内容を編集しました: ${Object.keys(contentData).join(', ')} (実行ユーザーID: ${actor})`,
          },
        });
      }

      return { kind: 'ok' as const, task: updated, releasedVehicleId };
    });

    if (outcome.kind === 'not_found') {
      return res.status(404).json({ error: 'タスクが見つかりません' });
    }
    if (outcome.kind === 'locked') {
      return res.status(409).json({ error: '配車済みのタスクは内容を編集できません' });
    }
    if (outcome.kind === 'bad_transition') {
      return res
        .status(409)
        .json({ error: `ステータスを ${outcome.from} から ${outcome.to} には変更できません` });
    }

    socketService.broadcastTasksChanged();
    if (outcome.releasedVehicleId) {
      socketService.broadcastVehicleUpdate({ id: outcome.releasedVehicleId, status: VehicleStatus.IDLE });
    }
    res.json(outcome.task);
  } catch (error) {
    console.error('タスク更新エラー:', error);
    res.status(500).json({ error: 'タスクの更新に失敗しました' });
  }
};
