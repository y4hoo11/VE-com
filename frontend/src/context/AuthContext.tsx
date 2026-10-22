/**
 * @file AuthContext.tsx
 * @description アプリケーション全体でログイン状態を管理・共有する React Context & Provider。
 * 
 * 概要:
 * - セッションストレージ（`sessionStorage`）と連動し、ページリロード後もログイン状態を維持します。
 * - `AuthProvider` でアプリを包むことで、配下のコンポーネントから `useAuth` フックを通して
 *   ユーザー情報（`user`）やログイン/ログアウト関数にアクセスできます。
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import type { User } from '../types/Auth';
import { AUTH_CONFIG } from '../config/Auth';
import { AUTH_EXPIRED_EVENT } from '../services/api';
import { socket } from '../services/socket';

interface AuthContextType {
  user: User | null;
  login: (user: User, token?: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    const raw = sessionStorage.getItem(AUTH_CONFIG.sessionKey);
    return raw ? (JSON.parse(raw) as User) : null;
  });

  const login = (userData: User, token?: string) => {
    sessionStorage.setItem(AUTH_CONFIG.sessionKey, JSON.stringify(userData));
    if (token) sessionStorage.setItem(AUTH_CONFIG.tokenKey, token);
    setUser(userData);
  };

  const logout = () => {
    sessionStorage.removeItem(AUTH_CONFIG.sessionKey);
    sessionStorage.removeItem(AUTH_CONFIG.tokenKey);
    setUser(null);
  };

  // APIが401を返したら（トークン期限切れなど）自動でログアウトしてログイン画面に戻す
  useEffect(() => {
    const handleExpired = () => {
      sessionStorage.removeItem(AUTH_CONFIG.sessionKey);
      sessionStorage.removeItem(AUTH_CONFIG.tokenKey);
      setUser(null);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired);
  }, []);

  // ログイン中だけリアルタイム通信をつなぐ
  useEffect(() => {
    if (user) {
      socket.connect();
    } else {
      socket.disconnect();
    }
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};