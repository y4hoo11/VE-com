// controllers/taskController.ts
import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { dispatchService } from '../services/dispatchService';
import { TaskStatus } from '@prisma/client';
 
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
 
    const tasks = await prisma.task.findMany({
      where: includeCancelled ? undefined : { status: { not: TaskStatus.CANCELLED } },
      orderBy: { createdAt: 'desc' },
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
    const rawUserId = getStringParam(createdByUserId) || getStringParam((req as any).user?.id);
 
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
 
    res.status(201).json(result);
  } catch (error) {
    console.error('タスク作成エラー:', error);
    res.status(500).json({ error: 'タスクの作成に失敗しました' });
  }
};
 
export const deleteTask = async (req: Request, res: Response) => {
  try {
    const taskId = getStringParam(req.params.id);
    const userId = getStringParam(req.body?.userId) || getStringParam(req.query?.userId);
 
    if (!taskId) {
      return res.status(400).json({ error: 'タスクIDは必須です' });
    }
 
    const outcome = await prisma.$transaction(async (tx) => {
      const task = await tx.task.findUnique({ where: { id: taskId } });
 
      if (!task) return 'not_found' as const;
      // 実行中のタスクは車両への停止指示が必要なため、ここでは削除させない
      if (task.status === TaskStatus.IN_PROGRESS) return 'in_progress' as const;
      // 二重実行で completedAt の上書きや履歴の重複が起きないようにする
      if (task.status === TaskStatus.CANCELLED || task.status === TaskStatus.COMPLETED) {
        return 'already_done' as const;
      }
 
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
          note: `タスク「${task.title}」がキャンセルされました (実行ユーザーID: ${userId || '不明'})`,
        },
      });
 
      return 'ok' as const;
    });
 
    if (outcome === 'not_found') {
      return res.status(404).json({ error: 'タスクが見つかりません' });
    }
    if (outcome === 'in_progress') {
      return res.status(409).json({ error: '実行中のタスクは削除できません' });
    }
    if (outcome === 'already_done') {
      return res.status(409).json({ error: '既に完了またはキャンセル済みのタスクです' });
    }
 
    res.status(200).json({ message: 'タスクをキャンセル（削除）しました' });
  } catch (error) {
    console.error('タスク削除エラー:', error);
    // 内部エラーの詳細はクライアントに返さない
    res.status(500).json({ error: 'タスクの削除に失敗しました' });
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
 
    const updatedTask = await dispatchService.assignTask(tId, vId);
    res.json(updatedTask);
  } catch (error) {
    console.error('配車処理エラー:', error);
    res.status(500).json({ error: '配車処理に失敗しました' });
  }
};
 