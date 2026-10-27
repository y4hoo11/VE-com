// useSocketEvent.ts
import { useEffect, useRef } from 'react';
import { socket } from '../services/socket';

/**
 * Socket.IO のイベントを受け取るフック。画面が閉じたら自動で受信をやめる
 * 例: useSocketEvent('tasks:changed', () => fetchTasks());
 * 'connect' を指定すると、接続・再接続したときに呼ばれる（切断中の取りこぼしを取り直すのに使う）
 */
export function useSocketEvent<T = unknown>(event: string, handler: (payload: T) => void) {
  // 最新の handler を覚えておく（毎回登録し直さなくて済むように）
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const listener = (payload: T) => handlerRef.current(payload);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [event]);
}
