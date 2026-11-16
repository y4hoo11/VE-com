// socket.ts
// バックエンドとのリアルタイム通信（Socket.IO）。接続はアプリ全体で1本だけ使う
import { io, Socket } from 'socket.io-client';
import { AUTH_CONFIG } from '../config/Auth';
import { API_ORIGIN, AUTH_EXPIRED_EVENT } from './api';
import { demoAck, isDemo } from './demo'; // 【仮】デモモード

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

// サーバー側から切られたとき（権限が変わったときなど）は自動では再接続されないので、つなぎ直す。
// 削除されたユーザーなら、つなぎ直しが unauthorized になってログイン画面に戻る
socket.on('disconnect', (reason) => {
  if (reason === 'io server disconnect') socket.connect();
});

// 同じアカウントで別の端末からログインされた（後からログインした方が有効）。
// 理由をログイン画面に出せるように残してから、ログイン画面に戻す
export const LOGIN_NOTICE_KEY = 'vecom_login_notice';
socket.on('session:replaced', () => {
  sessionStorage.setItem(LOGIN_NOTICE_KEY, '別の端末でログインされたため、この端末はログアウトしました');
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
});

// サーバーから返ってくる処理結果（note は、成功したときの補足）
export type SocketAck = { ok: boolean; error?: string; note?: string };

/**
 * サーバーにイベントを送り、結果を待つ（5秒で返事がなければ失敗扱い）
 * 例: const res = await emitWithAck('manual_emergency_stop', { vehicleId: 'AGV-01' });
 */
export const emitWithAck = (event: string, data: unknown): Promise<SocketAck> =>
  new Promise((resolve) => {
    // 【仮】デモ中は緊急停止なども実機へ送らない
    if (isDemo()) {
      resolve(demoAck(event, data));
      return;
    }
    if (!socket.connected) {
      resolve({ ok: false, error: 'サーバーとのリアルタイム接続が切れています' });
      return;
    }
    socket.timeout(5000).emit(event, data, (err: Error | null, res: SocketAck) => {
      resolve(err ? { ok: false, error: 'サーバーから応答がありません' } : res);
    });
  });
