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
            <label htmlFor="login-username" className="field-label">アカウント</label>
            <input
              id="login-username"
              type="text"
              className="field-input"
              placeholder="アカウント名を入力"
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
              >
                {showPassword ? '隠す' : '表示'}
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