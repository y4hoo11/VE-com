// api.ts
import axios from 'axios';
import { AUTH_CONFIG } from '../config/Auth';
import { demoAdapter, isDemo } from './demo'; // 【仮】デモモード

// バックエンドのURL（API と Socket.IO の両方で使う）。
// frontend/.env の VITE_API_ORIGIN があればそれを使う。無ければ「この画面を開いた PC の 3001 番」。
//   PC2 で http://localhost:5173 を開く            → http://localhost:3001
//   ほかの端末で http://<PC2のIP>:5173 を開く       → http://<PC2のIP>:3001
const fromEnv = import.meta.env.VITE_API_ORIGIN?.trim().replace(/\/+$/, '');
export const API_ORIGIN = fromEnv || `${window.location.protocol}//${window.location.hostname}:3001`;

export const api = axios.create({
  baseURL: `${API_ORIGIN}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ログアウトが必要になったことを AuthContext に知らせるイベント名
export const AUTH_EXPIRED_EVENT = 'vecom:auth-expired';

// すべてのリクエストに、ログイン時にもらったトークンを自動で付ける
api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem(AUTH_CONFIG.tokenKey);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // 【仮】デモ中はログイン以外をサーバーへ送らない
  if (isDemo() && config.url !== '/login') config.adapter = demoAdapter;
  return config;
});

// 401（未ログイン・期限切れ）が返ってきたらログイン画面に戻す
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const isLoginRequest = error.config?.url === '/login';
    if (error.response?.status === 401 && !isLoginRequest) {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    return Promise.reject(error);
  }
);
