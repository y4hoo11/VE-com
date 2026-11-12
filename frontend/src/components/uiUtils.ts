// 画面の共通の関数・定数（日時や数値の書式、クラス名のつなぎ方、タスクの状態の色）。
// コンポーネントは ui.tsx。分けておくと、開発中のホットリロードが ui.tsx でも効く
import type { TStatus } from '../store/data';

const pad = (n: number) => String(n).padStart(2, '0');
export const fmtT = (ts: number) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
export const fmtDT = (ts: number | null) => {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
// 値が届いていないときは「—」
export const fmtNum = (v: number | null | undefined, digits: number, unit = '') => (v == null ? '—' : `${v.toFixed(digits)}${unit}`);
export const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)}%`);

export const TS_DOT: Record<TStatus, string> = {
  PENDING: 'bg-slate-400',
  ASSIGNED: 'bg-violet-500',
  IN_PROGRESS: 'bg-blue-500',
  COMPLETED: 'bg-green-500',
  CANCELLED: 'bg-slate-300',
  FAILED: 'bg-red-500',
};
