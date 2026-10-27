// socket.ts
// バックエンドとのリアルタイム通信（Socket.IO）。接続はアプリ全体で1本だけ使う
import { io, Socket } from 'socket.io-client';
import { AUTH_CONFIG } from '../config/Auth';
import { API_ORIGIN, AUTH_EXPIRED_EVENT } from './api';

export const socket: Socket = io(API_ORIGIN, {
  autoConnect: false, // ログインしてから AuthContext が接続する
  // 接続・再接続のたびに最新のトークンを送る
  auth: (cb) => cb({ token: sessionStorage.getItem(AUTH_CONFIG.tokenKey) }),
});

// トークンが無効でつながらないときはログイン画面に戻す
socket.on('connect_error', (err) => {
  if (err.message === 'unauthorized') {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
});

// サーバーから返ってくる処理結果
export type SocketAck = { ok: boolean; error?: string };

/**
 * サーバーにイベントを送り、結果を待つ（5秒で返事がなければ失敗扱い）
 * 例: const res = await emitWithAck('manual_emergency_stop', { vehicleId: 'AGV-01' });
 */
export const emitWithAck = (event: string, data: unknown): Promise<SocketAck> =>
  new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ ok: false, error: 'サーバーとのリアルタイム接続が切れています' });
      return;
    }
    socket.timeout(5000).emit(event, data, (err: Error | null, res: SocketAck) => {
      resolve(err ? { ok: false, error: 'サーバーから応答がありません' } : res);
    });
  });
