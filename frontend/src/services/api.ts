// api.ts
import axios from 'axios';
import { AUTH_CONFIG } from '../config/Auth';

export const api = axios.create({
  baseURL: 'http://localhost:3001/api',
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
