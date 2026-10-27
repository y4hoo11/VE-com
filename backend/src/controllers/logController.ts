// controllers/logController.ts
import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { LogLevel } from '@prisma/client';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const getStringParam = (param: unknown): string | undefined => {
  if (typeof param === 'string') return param;
  if (Array.isArray(param) && typeof param[0] === 'string') return param[0];
  return undefined;
};

/**
 * GET /api/logs
 * クエリ: vehicleId (任意), level (任意: INFO|WARN|ERROR), limit (任意: 1〜200, 既定50)
 * 新しい順に返す
 */
export const getLogs = async (req: Request, res: Response) => {
  try {
    const vehicleId = getStringParam(req.query.vehicleId);
    const levelParam = getStringParam(req.query.level)?.toUpperCase();
    const limitParam = parseInt(getStringParam(req.query.limit) || '', 10);

    if (levelParam && !Object.values(LogLevel).includes(levelParam as LogLevel)) {
      return res.status(400).json({ error: 'level は INFO / WARN / ERROR のいずれかです' });
    }

    const limit = Number.isNaN(limitParam)
      ? DEFAULT_LIMIT
      : Math.min(MAX_LIMIT, Math.max(1, limitParam));

    const logs = await prisma.vehicleLog.findMany({
      where: {
        ...(vehicleId ? { vehicleId } : {}),
        ...(levelParam ? { logLevel: levelParam as LogLevel } : {}),
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    // id は BigInt のため、そのままでは JSON にできないので文字列に変換
    res.json(
      logs.map((log) => ({
        id: log.id.toString(),
        vehicleId: log.vehicleId,
        level: log.logLevel,
        message: log.message,
        details: log.details,
        timestamp: log.timestamp.toISOString(),
      }))
    );
  } catch (error) {
    console.error('ログ取得エラー:', error);
    res.status(500).json({ error: 'ログの取得に失敗しました' });
  }
};
