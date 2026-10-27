/**
 * @file Auth.ts
 * @description 認証設定および開発用モックデータの定義ファイル。
 * 
 * 概要:
 * - `AUTH_CONFIG`: セッションストレージの保存キー名やモック/本番切り替えフラグを保持。
 * - `MOCK_ACCOUNTS`: ローカル開発時用のモックログインアカウント一覧。
 */

import type { Account } from '../types/Auth';

export const AUTH_CONFIG = {
  sessionKey: 'vecom_auth_session',
  tokenKey: 'vecom_auth_token', // バックエンドが発行したトークンの保存キー
  useMock: false, // true にするとバックエンドなしでモックログインできる（APIはトークンなしで401になる）
};

// 開発用モックアカウント（本番環境では使用しない）
export const MOCK_ACCOUNTS: Account[] = [
  { username: 'admin', password: 'admin123', role: 'admin' },
  { username: 'member', password: 'member123', role: 'member' },
];