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

export const getTasks = async (req: Request, res: Response) => {
  try {
    const tasks = await prisma.task.findMany({
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
    res.status(500).json({ error: 'タスク一覧の取得に失敗しました' });
  }
};

export const createTask = async (req: Request, res: Response) => {
  try {
    const { title, name, startLocation, targetLocation, priority, scheduledAt, createdByUserId } = req.body;

    const taskTitle = getStringParam(title) || getStringParam(name);
    const sLocation = getStringParam(startLocation);
    const tLocation = getStringParam(targetLocation);
    const rawUserId = getStringParam(createdByUserId) || getStringParam((req as any).user?.id);

    if (!taskTitle) {
      return res.status(400).json({ error: 'タスクタイトル (title) は必須です' });
    }

    const userId = rawUserId || null;
    const parsedPriority = typeof priority === 'number' ? priority : parseInt(getStringParam(priority) || '3', 10);
    const parsedScheduledAt = scheduledAt ? new Date(String(scheduledAt)) : null;

    // トランザクションでタスク作成と履歴記録をアトミックに実行
    const result = await prisma.$transaction(async (tx) => {
      const newTask = await tx.task.create({
        data: {
          title: taskTitle,
          startLocation: sLocation,
          targetLocation: tLocation,
          priority: isNaN(parsedPriority) ? 3 : parsedPriority,
          scheduledAt: parsedScheduledAt && !isNaN(parsedScheduledAt.getTime()) ? parsedScheduledAt : null,
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
    console.error(error);
    res.status(500).json({ error: 'タスクの作成に失敗しました' });
  }
};

export const deleteTask = async (req: Request, res: Response) => {
  try {
    const taskId = getStringParam(req.params.id);
    // DELETE メソッドではボディが正しく渡らないことがあるため、query や headers からもフォールバックして取得できるようにする
    const userId = getStringParam(req.body?.userId) || getStringParam(req.query?.userId);

    if (!taskId) {
      return res.status(400).json({ error: 'タスクIDは必須です' });
    }

    await prisma.$transaction(async (tx) => {
      // 1. 存在確認
      const existingTask = await tx.task.findUnique({
        where: { id: taskId },
      });

      if (!existingTask) {
        throw new Error('Task not found');
      }

      // 2. ★先にごく確実に TaskHistory を作成する（Task削除の前に実行）
      await tx.taskHistory.create({
        data: {
          taskId: existingTask.id,
          status: TaskStatus.CANCELLED,
          note: `タスク「${existingTask.title}」が削除されました (実行ユーザーID: ${userId || '不明'})`,
        },
      });

      // 3. 最後に Task 本体を削除
      await tx.task.delete({
        where: { id: taskId },
      });
    });

    res.status(200).json({ message: 'タスクが正常に削除されました' });
  } catch (error) {
    console.error('タスク削除エラー:', error);
    res.status(500).json({ error: 'タスクの削除に失敗しました' });
  }
};

export const assignTask = async (req: Request, res: Response) => {
  try {
    const { taskId, vehicleId } = req.body;
    const updatedTask = await dispatchService.assignTask(getStringParam(taskId) || '', getStringParam(vehicleId) || '');
    res.json(updatedTask);
  } catch (error) {
    res.status(500).json({ error: '配車処理に失敗しました' });
  }
};