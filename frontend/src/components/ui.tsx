// 共通の小さな部品（コンポーネントだけ。関数・定数は uiUtils.ts）
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { COL, PAUSED_COL, ST, TS, type Level, type TStatus, type Vehicle } from '../store/data';
import { S, useStore } from '../store/store';
import { cx } from './uiUtils';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'pri' | 'danger' | 'dangerO' | 'ghost';
  size?: 'sm' | 'md';
  op?: boolean; // 運行操作のボタン（VIEWER には表示しない）
  admin?: boolean; // 管理者だけのボタン
};
export function Btn({ variant = 'default', size = 'md', op, admin, className, ...p }: BtnProps) {
  useStore();
  if (op && S.user.role === 'VIEWER') return null;
  if (admin && S.user.role !== 'ADMIN') return null;
  const v = {
    default: 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
    pri: 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700',
    danger: 'border-red-600 bg-red-600 text-white hover:bg-red-700',
    dangerO: 'border-red-300 bg-white text-red-600 hover:bg-red-50 dark:border-red-800 dark:bg-slate-800 dark:hover:bg-red-950',
    ghost: 'border-transparent bg-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700',
  }[variant];
  const s = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm';
  return (
    <button
      type="button"
      className={cx('inline-flex items-center justify-center gap-1 rounded-md border font-medium whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-40', v, s, className)}
      {...p}
    />
  );
}

export function VChip({ v }: { v: Vehicle }) {
  const paused = v.paused && v.status === 'RUNNING';
  const c = paused ? PAUSED_COL : COL[v.status];
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: c + '1f', color: c }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {paused ? '一時停止' : ST[v.status]}
    </span>
  );
}

const TS_CLASS: Record<TStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200',
  ASSIGNED: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  IN_PROGRESS: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  COMPLETED: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
  CANCELLED: 'bg-slate-100 text-slate-500 line-through dark:bg-slate-700 dark:text-slate-400',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
};
export function TChip({ s }: { s: TStatus }) {
  return <span className={cx('inline-block rounded-full px-2 py-0.5 text-xs font-semibold', TS_CLASS[s])}>{TS[s]}</span>;
}

export function LvChip({ l }: { l: Level }) {
  const c = {
    INFO: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
    WARN: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    ERROR: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  }[l];
  return <span className={cx('inline-block w-12 rounded px-1.5 py-0.5 text-center text-[11px] font-bold', c)}>{l}</span>;
}

export function PrioChip({ p }: { p: number }) {
  return (
    <span className={cx('inline-block rounded px-1.5 py-0.5 text-xs font-bold', p >= 4 ? 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300')}>
      P{p}
    </span>
  );
}

export function Bar({ value, className }: { value: number | null; className?: string }) {
  return (
    <div className={cx('h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700', className)}>
      <div className="h-full rounded-full bg-blue-500 transition-[width] duration-200" style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
    </div>
  );
}

export function Battery({ v }: { v: Vehicle }) {
  if (v.battery == null || !v.online) return <span className="text-slate-400">🔋—</span>;
  const b = Math.round(v.battery);
  const c = b < S.ops.battMin ? 'text-red-600 font-bold' : b < S.ops.battWarn ? 'text-amber-600 font-semibold' : '';
  return <span className={c}>🔋{b}%</span>;
}

export function Card({ title, right, children, className, bodyClass }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cx('flex min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900', className)}>
      {title && (
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-2.5 font-bold dark:border-slate-700">
          {title}
          <div className="flex-1" />
          {right}
        </div>
      )}
      <div className={cx('min-h-0 flex-1', bodyClass)}>{children}</div>
    </section>
  );
}

export function Kv({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
          <dd className="m-0 font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('border-t border-slate-200 pt-3 dark:border-slate-700', className)}>
      <div className="mb-2 text-xs font-bold tracking-wide text-slate-500 dark:text-slate-400">{title}</div>
      {children}
    </div>
  );
}

export const inputCls =
  'w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:focus:ring-blue-900 dark:disabled:bg-slate-800/50';

export function Field({ label, hint, children, opt }: { label: string; hint?: string; children: ReactNode; opt?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
        {label}
        {opt && <span className="font-normal text-slate-400">任意</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export function Tag({ children, tone = 'gray' }: { children: ReactNode; tone?: 'gray' | 'red' | 'blue' | 'amber' | 'green' }) {
  const c = {
    gray: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    green: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
  }[tone];
  return <span className={cx('inline-block rounded px-1.5 py-0.5 text-[11px] font-bold', c)}>{children}</span>;
}
