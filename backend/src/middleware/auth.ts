// middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { JWT_SECRET } from '../config/auth';
import { prisma } from '../config/database';
import type { AuthUser } from '../types/express';

// トークンの中身（ログイン時に authController が発行する）
interface TokenPayload {
  sub: string; // ユーザーID
  username: string;
  role: Role;
}

/**
 * トークンを検証してユーザー情報を返す。不正・期限切れなら null
 * HTTP と Socket.IO の両方で使う
 */
export const verifyToken = (token: string): AuthUser | null => {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
    if (!payload.sub || !payload.username || !payload.role) return null;
    return { id: payload.sub, username: payload.username, role: payload.role };
  } catch {
    return null;
  }
};

/**
 * トークンを検証し、そのユーザーが今も DB にいるか確かめて、最新のユーザー名・権限を返す。
 * 削除されたユーザーは null（トークンの期限内でも使えなくする）。権限の変更もすぐ反映される
 */
export const authenticate = async (token: string): Promise<AuthUser | null> => {
  const payload = verifyToken(token);
  if (!payload) return null;
  const user = await prisma.user.findUnique({
    where: { id: payload.id },
    select: { id: true, username: true, role: true },
  });
  return user;
};

/**
 * ログイン必須にするミドルウェア
 * 「Authorization: Bearer <トークン>」ヘッダーを確認し、OKなら req.user をセットする
 */
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

  if (!token) {
    return res.status(401).json({ error: 'ログインが必要です' });
  }

  try {
    const user = await authenticate(token);
    if (!user) {
      return res.status(401).json({ error: 'ログインの有効期限が切れたか、無効なトークンです' });
    }
    req.user = user;
    next();
  } catch (error) {
    console.error('認証エラー:', error);
    res.status(500).json({ error: '認証の確認に失敗しました' });
  }
};

/**
 * 特定のロールだけ許可するミドルウェア（requireAuth の後に使う）
 * 例: router.delete('/users/:id', requireRole(Role.ADMIN), deleteUser);
 * いまは車両の登録・編集・削除、運行の設定の変更、ユーザー管理に使っている
 */
export const requireRole =
  (...roles: Role[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'この操作を行う権限がありません' });
    }
    next();
  };
