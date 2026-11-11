/**
 * @file Login.tsx
 * @description VE-com システムのログイン画面コンポーネント。
 *
 * 概要:
 * - ユーザー名・パスワードによる認証フォームの表示と制御を行います。
 * - `AUTH_CONFIG.useMock` のフラグ状態に応じて、開発用モックログインと
 *   実際のバックエンドAPI (`/api/login`) への通信処理を自動切り替えします。
 * - 認証成功時は `AuthContext` 経由でセッション状態を更新します。
 */

import React, { useState } from 'react';
import { isAxiosError } from 'axios';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { AUTH_CONFIG, MOCK_ACCOUNTS } from '../config/Auth';
import type { AuthResult } from '../types/Auth';
import { LoginBackground } from '../components/login/LoginBackground';
import '../styles/login.css';

export const Login: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const mockLogin = (u: string, p: string): Promise<AuthResult> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        const account = MOCK_ACCOUNTS.find(
          (a) => a.username === u && a.password === p
        );
        resolve(
          account
            ? { success: true, user: { username: account.username, role: account.role || 'member' } }
            : { success: false, message: 'ユーザー名またはパスワードが違います' }
        );
      }, 250);
    });
  };

  const serverLogin = async (u: string, p: string): Promise<AuthResult> => {
    try {
      const res = await api.post<AuthResult>('/login', { username: u, password: p });
      return res.data;
    } catch (err) {
      // 401/400 のときはサーバーのメッセージ（「ユーザー名またはパスワードが違います」など）を表示
      if (isAxiosError(err) && err.response?.data?.message) {
        return { success: false, message: err.response.data.message };
      }
      return { success: false, message: 'サーバーに接続できませんでした' };
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError('ユーザー名とパスワードを入力してください');
      return;
    }

    setLoading(true);
    const result = AUTH_CONFIG.useMock
      ? await mockLogin(username, password)
      : await serverLogin(username, password);
    setLoading(false);

    if (result.success) {
      login(result.user, result.token);
    } else {
      setError(result.message);
    }
  };

  return (
    <section className="login-screen">
      <div className="stripe stripe--top" aria-hidden="true" />
      <div className="stripe stripe--bottom-1" aria-hidden="true" />
      <div className="stripe stripe--bottom-2" aria-hidden="true" />
      <LoginBackground />

      <form className="login-card" onSubmit={handleSubmit}>
        <header className="login-header">
          <h1 className="logo">
            <span className="logo-accent">VE</span>
            <span className="logo-rest">-com</span>
          </h1>
          <p className="login-subtitle">管理システム</p>
        </header>

        <div className="fields">
          <div className="field">
            <label htmlFor="login-username" className="field-label">ユーザー名</label>
            <input
              id="login-username"
              type="text"
              className="field-input"
              placeholder="ユーザー名を入力"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="login-password" className="field-label">パスワード</label>
            <div className="password-wrap">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                className="field-input field-input--password"
                placeholder="パスワードを入力"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
    type="button"
    className="password-toggle"
    onClick={() => setShowPassword((v) => !v)}
    aria-pressed={showPassword}
    aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
    title={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
  >
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {showPassword ? (
        <>
          <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a19.8 19.8 0 0 1 5.06-5.94" />
          <path d="M9.9 4.24A10.9 10.9 0 0 1 12 5c7 0 11 7 11 7a19.7 19.7 0 0 1-3.17 4.19" />
          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      ) : (
        <>
          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  </button>
            </div>
          </div>
        </div>

        {error && <p className="error-message" role="alert">{error}</p>}

        <button type="submit" className="login-button" disabled={loading}>
          {loading ? '処理中...' : 'ログイン'}
        </button>
      </form>
    </section>
  );
};