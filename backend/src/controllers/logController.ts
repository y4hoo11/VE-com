// controllers/logController.ts
import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { LogLevel } from '@prisma/client';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000; // 1回で返す最大件数（CSV 出力はページを分けて全件取る）

const getStringParam = (param: unknown): string | undefined => {
  if (typeof param === 'string') return param;
  if (Array.isArray(param) && typeof param[0] === 'string') return param[0];
  return undefined;
};

// ISO 形式などの日時を Date にする。空なら undefined、読めなければ null
const getDateParam = (param: unknown): Date | null | undefined => {
  const s = getStringParam(param);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * GET /api/logs
 * クエリ（すべて任意）:
 *   vehicleId  車両ID
 *   level      INFO|WARN|ERROR（カンマ区切りで複数可: INFO,WARN）
 *   from, to   期間（ISO 形式。from 以上・to 未満）
 *   q          メッセージに含まれる文字
 *   limit      1〜1000（既定50）
 *   offset     先頭から飛ばす件数（ページ送り）
 * 新しい順に返す。条件に合う全件数をヘッダー X-Total-Count に入れる
 */
export const getLogs = async (req: Request, res: Response) => {
  try {
    const vehicleId = getStringParam(req.query.vehicleId);
    const levels = (getStringParam(req.query.level) ?? '')
      .split(',')
      .map((l) => l.trim().toUpperCase())
      .filter(Boolean);
    const from = getDateParam(req.query.from);
    const to = getDateParam(req.query.to);
    const q = getStringParam(req.query.q)?.trim();
    const limitParam = parseInt(getStringParam(req.query.limit) || '', 10);
    const offsetParam = parseInt(getStringParam(req.query.offset) || '', 10);

    if (levels.some((l) => !Object.values(LogLevel).includes(l as LogLevel))) {
      return res.status(400).json({ error: 'level は INFO / WARN / ERROR のいずれかです' });
    }
    if (from === null || to === null) {
      return res.status(400).json({ error: 'from / to の日時が読めません' });
    }

    const limit = Number.isNaN(limitParam)
      ? DEFAULT_LIMIT
      : Math.min(MAX_LIMIT, Math.max(1, limitParam));
    const offset = Number.isNaN(offsetParam) ? 0 : Math.max(0, offsetParam);

    const where = {
      ...(vehicleId ? { vehicleId } : {}),
      ...(levels.length ? { logLevel: { in: levels as LogLevel[] } } : {}),
      ...(from || to ? { timestamp: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
      ...(q ? { message: { contains: q, mode: 'insensitive' as const } } : {}),
    };

    const [logs, total] = await Promise.all([
      prisma.vehicleLog.findMany({
        where,
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
      }),
      prisma.vehicleLog.count({ where }),
    ]);

    res.set('X-Total-Count', String(total));
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
