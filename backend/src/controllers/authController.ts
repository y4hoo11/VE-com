// controllers/authController.ts
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import { JWT_SECRET, JWT_EXPIRES_IN_SECONDS, BCRYPT_ROUNDS } from '../config/auth';

// 存在しないユーザー名でも照合処理の時間を揃えるためのダミーハッシュ（起動時に1回だけ作る）
// （応答時間の差から「そのユーザー名が存在するか」を推測されないようにする）
const DUMMY_HASH = bcrypt.hashSync('dummy-password', BCRYPT_ROUNDS);

const LOGIN_FAILED_MESSAGE = 'ユーザー名またはパスワードが違います';

/**
 * POST /api/login
 * body: { username, password }
 * 成功: { success: true, token, user: { id, username, role } }
 * 失敗: 401 { success: false, message }
 */
export const login = async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body ?? {};

    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      return res.status(400).json({ success: false, message: 'ユーザー名とパスワードを入力してください' });
    }

    const user = await prisma.user.findUnique({ where: { username: username.trim() } });

    // ユーザーがいない場合もダミーで照合して、処理時間を同じにする
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !ok) {
      // 「ユーザー名が違う」「パスワードが違う」を区別しない（どちらが合っているか推測させない）
      return res.status(401).json({ success: false, message: LOGIN_FAILED_MESSAGE });
    }

    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, {
      subject: user.id,
      expiresIn: JWT_EXPIRES_IN_SECONDS,
    });

    res.json({
      success: true,
      token,
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (error) {
    console.error('ログインエラー:', error);
    res.status(500).json({ success: false, message: 'ログイン処理に失敗しました' });
  }
};

/**
 * GET /api/me
 * 今のトークンのユーザー情報を返す（トークンがまだ有効かの確認用）
 */
export const getMe = (req: Request, res: Response) => {
  res.json({ user: req.user });
};
