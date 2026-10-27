// config/auth.ts
import dotenv from 'dotenv';

dotenv.config();

// トークンの署名に使う秘密の文字列。漏れると誰でもトークンを偽造できるため、.env で管理する
const secret = process.env.JWT_SECRET;

if (!secret) {
  console.error('[Auth] 環境変数 JWT_SECRET が設定されていません。backend/.env に追加してください');
  process.exit(1);
}

export const JWT_SECRET: string = secret;

// トークンの有効期限（秒）。切れたら再ログインが必要
export const JWT_EXPIRES_IN_SECONDS = 8 * 60 * 60; // 8時間

// パスワードハッシュの強さ（大きいほど安全だが遅い。10〜12が一般的）
export const BCRYPT_ROUNDS = 10;
