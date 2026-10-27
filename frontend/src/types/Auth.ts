/**
 * @file Auth.ts
 * @description 認証機能全般で使用される型定義ファイル。
 * 
 * 主な定義:
 * - `User`: ログイン中のユーザー情報（ユーザー名、権限 role）。
 * - `AuthResult`: ログイン処理の結果を表す Discriminated Union 型（成功/失敗）。
 * - `Account`: 認証処理やモックデータで扱うアカウント情報。
 */

export interface User {
  id?: string;
  username: string;
  role: string;
}

export type AuthResult =
  | { success: true; user: User; token?: string }
  | { success: false; message: string };

export interface Account {
  username: string;
  password: string;
  role?: string;
}