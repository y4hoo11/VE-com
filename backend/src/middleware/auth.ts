// middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { JWT_SECRET } from '../config/auth';
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
 * ログイン必須にするミドルウェア
 * 「Authorization: Bearer <トークン>」ヘッダーを確認し、OKなら req.user をセットする
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

  if (!token) {
    return res.status(401).json({ error: 'ログインが必要です' });
  }

  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: 'ログインの有効期限が切れたか、無効なトークンです' });
  }

  req.user = user;
  next();
};

/**
 * 特定のロールだけ許可するミドルウェア（requireAuth の後に使う）
 * 例: router.delete('/users/:id', requireRole(Role.ADMIN), deleteUser);
 * ※ 現時点ではどのルートにも使っていない（ロール制御は今後）
 */
export const requireRole =
  (...roles: Role[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'この操作を行う権限がありません' });
    }
    next();
  };
