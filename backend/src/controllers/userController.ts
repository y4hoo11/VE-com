// controllers/userController.ts
// ユーザー管理（ADMIN のみ）と、自分のパスワードの変更
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../config/database';
import { BCRYPT_ROUNDS } from '../config/auth';
import { socketService } from '../services/socketService';

const USERNAME_MAX = 32;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72; // bcrypt は 72 バイトより後ろを使わないため
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;
const ROLES = Object.values(Role) as string[];

// 画面に返す形（パスワードのハッシュは返さない）
const PUBLIC_FIELDS = { id: true, username: true, email: true, role: true, createdAt: true } as const;

const readUsername = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= USERNAME_MAX && !/\s/.test(s) ? s : null;
};
const readEmail = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length <= 254 && EMAIL_RE.test(s) ? s : null;
};
const passwordError = (v: unknown) =>
  typeof v !== 'string' || v.length < PASSWORD_MIN || v.length > PASSWORD_MAX
    ? `パスワードは ${PASSWORD_MIN}〜${PASSWORD_MAX} 文字にしてください`
    : null;

// ユーザー名・メールアドレスの重複（DB の unique 制約）を、分かる文言にする
function duplicateMessage(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = String(error.meta?.target ?? '');
    return target.includes('email') ? 'そのメールアドレスはすでに使われています' : 'そのユーザー名はすでに使われています';
  }
  return null;
}

// ADMIN が1人もいなくなる操作は断る（誰も管理できなくなるため）
async function isLastAdmin(userId: string) {
  const admins = await prisma.user.findMany({ where: { role: Role.ADMIN }, select: { id: true } });
  return admins.length === 1 && admins[0].id === userId;
}

/** GET /api/users（ADMIN） */
export const getUsers = async (_req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({ select: PUBLIC_FIELDS, orderBy: { createdAt: 'asc' } });
    res.json(users);
  } catch (error) {
    console.error('ユーザー一覧の取得エラー:', error);
    res.status(500).json({ error: 'ユーザー一覧の取得に失敗しました' });
  }
};

/** POST /api/users（ADMIN）ボディ: { username, email, role, password } */
export const createUser = async (req: Request, res: Response) => {
  const username = readUsername(req.body?.username);
  const email = readEmail(req.body?.email);
  const role = req.body?.role;
  const password = req.body?.password;

  if (!username) return res.status(400).json({ error: `ユーザー名は空白なしの 1〜${USERNAME_MAX} 文字にしてください` });
  if (!email) return res.status(400).json({ error: 'メールアドレスの形が正しくありません' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: '権限の指定が正しくありません' });
  const pwErr = passwordError(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  try {
    const user = await prisma.user.create({
      data: { username, email, role, passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS) },
      select: PUBLIC_FIELDS,
    });
    socketService.broadcastUsersChanged();
    res.status(201).json(user);
  } catch (error) {
    const dup = duplicateMessage(error);
    if (dup) return res.status(409).json({ error: dup });
    console.error('ユーザーの追加エラー:', error);
    res.status(500).json({ error: 'ユーザーの追加に失敗しました' });
  }
};

/**
 * PATCH /api/users/:id（ADMIN）ボディ: { username?, email?, role?, password? }
 * password を入れると、そのユーザーのパスワードを再設定する（忘れたとき用）
 */
export const updateUser = async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const body = req.body ?? {};
  const data: Prisma.UserUpdateInput = {};

  if (body.username !== undefined) {
    const username = readUsername(body.username);
    if (!username) return res.status(400).json({ error: `ユーザー名は空白なしの 1〜${USERNAME_MAX} 文字にしてください` });
    data.username = username;
  }
  if (body.email !== undefined) {
    const email = readEmail(body.email);
    if (!email) return res.status(400).json({ error: 'メールアドレスの形が正しくありません' });
    data.email = email;
  }
  if (body.role !== undefined) {
    if (!ROLES.includes(body.role)) return res.status(400).json({ error: '権限の指定が正しくありません' });
    data.role = body.role;
  }
  if (body.password !== undefined && body.password !== '') {
    const pwErr = passwordError(body.password);
    if (pwErr) return res.status(400).json({ error: pwErr });
    data.passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
  }

  try {
    const current = await prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!current) return res.status(404).json({ error: 'ユーザーが見つかりません' });

    const roleChanged = data.role !== undefined && data.role !== current.role;
    if (roleChanged && id === req.user?.id) {
      return res.status(409).json({ error: '自分の権限は変更できません（ほかの管理者に変更してもらってください）' });
    }
    if (roleChanged && current.role === Role.ADMIN && (await isLastAdmin(id))) {
      return res.status(409).json({ error: '管理者（ADMIN）が1人もいなくなるため、権限を変更できません' });
    }

    const user = await prisma.user.update({ where: { id }, data, select: PUBLIC_FIELDS });
    socketService.broadcastUsersChanged();
    // 権限が変わったら、その人の画面を再接続させて最新の権限にする
    if (roleChanged) socketService.disconnectUser(id);
    res.json(user);
  } catch (error) {
    const dup = duplicateMessage(error);
    if (dup) return res.status(409).json({ error: dup });
    console.error('ユーザーの更新エラー:', error);
    res.status(500).json({ error: 'ユーザーの更新に失敗しました' });
  }
};

/**
 * DELETE /api/users/:id（ADMIN）
 * 作成したタスク・変更した設定は残る（作成者・変更者の欄が空になる）
 */
export const deleteUser = async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (id === req.user?.id) return res.status(409).json({ error: '自分自身は削除できません' });

  try {
    const user = await prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (!user) return res.status(404).json({ error: 'ユーザーが見つかりません' });
    if (user.role === Role.ADMIN && (await isLastAdmin(id))) {
      return res.status(409).json({ error: '管理者（ADMIN）が1人もいなくなるため、削除できません' });
    }

    await prisma.user.delete({ where: { id } });
    socketService.broadcastUsersChanged();
    socketService.disconnectUser(id); // ログイン中なら、すぐにログイン画面へ戻す
    res.json({ ok: true });
  } catch (error) {
    console.error('ユーザーの削除エラー:', error);
    res.status(500).json({ error: 'ユーザーの削除に失敗しました' });
  }
};

/** GET /api/me　ログイン中のユーザー（メールアドレス・登録日も含む） */
export const getMe = async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: PUBLIC_FIELDS });
    if (!user) return res.status(401).json({ error: 'ユーザーが見つかりません' });
    res.json({ user });
  } catch (error) {
    console.error('ユーザー情報の取得エラー:', error);
    res.status(500).json({ error: 'ユーザー情報の取得に失敗しました' });
  }
};

/** PUT /api/me/password　ボディ: { currentPassword, newPassword }（本人が自分のパスワードを変える） */
export const changeMyPassword = async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || !currentPassword) {
    return res.status(400).json({ error: '今のパスワードを入力してください' });
  }
  const pwErr = passwordError(newPassword);
  if (pwErr) return res.status(400).json({ error: pwErr });
  if (newPassword === currentPassword) return res.status(400).json({ error: '新しいパスワードが今のパスワードと同じです' });

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(401).json({ error: 'ユーザーが見つかりません' });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return res.status(400).json({ error: '今のパスワードが違います' });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) },
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('パスワードの変更エラー:', error);
    res.status(500).json({ error: 'パスワードの変更に失敗しました' });
  }
};
