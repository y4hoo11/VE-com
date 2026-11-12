// 共通の小さな部品
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { COL, PAUSED_COL, RANKS, REQ_STATUS, ST, TS, type Level, type Rank, type ReqStatus, type SettingItem, type TStatus, type Vehicle } from '../store/data';
import { S, useStore } from '../store/store';

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
export const TS_DOT: Record<TStatus, string> = {
  PENDING: 'bg-slate-400',
  ASSIGNED: 'bg-violet-500',
  IN_PROGRESS: 'bg-blue-500',
  COMPLETED: 'bg-green-500',
  CANCELLED: 'bg-slate-300',
  FAILED: 'bg-red-500',
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

// ---------------------------------------------------------------
// 設定変更の申請・承認の画面で使う部品
// ---------------------------------------------------------------
export function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={cx('h-4 w-4', className)}>
      <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z" />
    </svg>
  );
}

export function PersonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={cx('h-4 w-4', className)}>
      <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-5 0-9 2.5-9 6v2h18v-2c0-3.5-4-6-9-6Z" />
    </svg>
  );
}

export function RankBadge({ rank }: { rank: Rank }) {
  return <span className={cx('rounded-full px-3 py-1 text-xs font-bold whitespace-nowrap', RANKS[rank].cls)}>{RANKS[rank].badge}</span>;
}

export function ReqChip({ status }: { status: ReqStatus }) {
  return <span className={cx('inline-block rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', REQ_STATUS[status].cls)}>{REQ_STATUS[status].label}</span>;
}

export function FormRow({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[200px_minmax(0,1fr)] items-start gap-4 border-b border-slate-100 py-3 dark:border-slate-800">
      <div className="pt-1">
        <div className="flex items-center gap-2 font-semibold">
          {label}
          {required && <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[11px] font-bold text-red-600 dark:bg-red-950 dark:text-red-300">必須</span>}
        </div>
        {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** 「現在の値 → 希望する値」。readOnly のときは希望する値も表示だけ */
export function ValueInput({ item, cur, value, onChange, readOnly }: { item: SettingItem; cur: string; value: string; onChange?: (v: string) => void; readOnly?: boolean }) {
  const box = 'rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
  const newBox = 'rounded-lg border-2 border-blue-500 bg-white px-3 py-1.5 text-sm font-bold dark:bg-slate-900';
  const label = 'mb-1 block text-xs text-slate-500';
  const set = (v: string) => onChange?.(v);
  if (item.type !== 'number') {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3">
        <div>
          <span className={label}>現在の内容</span>
          <div className={box}>{cur}</div>
        </div>
        <span className="pb-2 text-slate-400">→</span>
        <label className="block">
          <span className={label}>希望する内容</span>
          {readOnly ? (
            <div className={newBox}>{value}</div>
          ) : item.type === 'select' ? (
            <select className={cx(inputCls, 'py-2')} value={value} onChange={(e) => set(e.target.value)}>
              <option value="">選んでください</option>
              {item.options
                .filter((o) => o !== cur)
                .map((o) => (
                  <option key={o}>{o}</option>
                ))}
            </select>
          ) : (
            <input className={cx(inputCls, 'py-2')} placeholder={item.placeholder} value={value} onChange={(e) => set(e.target.value)} />
          )}
        </label>
      </div>
    );
  }
  const n = value === '' ? NaN : Number(value);
  const delta = Number((n - Number(cur)).toFixed(2));
  return (
    <>
      <div className="flex items-end gap-3">
        <div className="w-[116px]">
          <span className={label}>現在の値</span>
          <div className={box}>
            {cur} {item.unit}
          </div>
        </div>
        <span className="pb-2 text-slate-400">→</span>
        <label className="block w-40">
          <span className={label}>希望する値</span>
          {readOnly ? (
            <div className={newBox}>
              {value} <span className="text-xs font-normal text-slate-500">{item.unit}</span>
            </div>
          ) : (
            <span className="relative block">
              <input type="number" min={item.min} max={item.max} step={item.step} className={cx(inputCls, 'py-2 pr-12 font-bold')} value={value} onChange={(e) => set(e.target.value)} />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-slate-500">{item.unit}</span>
            </span>
          )}
        </label>
        {Number.isFinite(delta) && delta !== 0 && (
          <span className="mb-1.5 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            {delta > 0 ? '+' : ''}
            {delta} {item.deltaUnit ?? item.unit}
          </span>
        )}
      </div>
      {!readOnly && (
        <div className="mt-1.5 text-xs text-slate-500">
          申請できる範囲：{item.min} 〜 {item.max} {item.unit}
          {item.hardLimit && `（${item.max} は SHRAGD が定めた安全上限）`}
        </div>
      )}
    </>
  );
}

/** ランク（L1〜L3）の説明。setting_classification.xlsx の「ランク定義」。withL4 で L4 の行も出す */
export function RankLegend({ withL4 }: { withL4?: boolean }) {
  const td = 'py-2 pr-4 align-top';
  return (
    <Card title={<>危険度（ランク）について <span className="text-xs font-normal text-slate-500">設定項目は、間違えたときの危険の大きさでランク分けしています</span></>}>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500 dark:bg-slate-800">
          <tr>
            <th className="w-28 px-4 py-2">ランク</th>
            <th className="py-2">基準</th>
            <th className="py-2">必要な承認</th>
            <th className="py-2 pr-4">反映のしかた</th>
          </tr>
        </thead>
        <tbody>
          {([1, 2, 3] as const).map((r) => (
            <tr key={r} className="border-b border-slate-100 dark:border-slate-800">
              <td className={cx(td, 'px-4 whitespace-nowrap')}>
                <Tag tone={RANKS[r].tone}>{RANKS[r].short}</Tag> {RANKS[r].name}
              </td>
              <td className={td}>{RANKS[r].desc}</td>
              <td className={cx(td, 'whitespace-nowrap')}>{RANKS[r].need}</td>
              <td className={td}>{RANKS[r].reflect}</td>
            </tr>
          ))}
          {withL4 && (
            <tr className="border-b border-slate-100 dark:border-slate-800">
              <td className={cx(td, 'px-4 whitespace-nowrap')}>
                <span className="inline-block rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-300">L4</span> SHRAGD のみ
              </td>
              <td className={td}>安全や通信の根幹。企業側では変更できない</td>
              <td className={cx(td, 'whitespace-nowrap')}>企業からは申請できない</td>
              <td className={td}>SHRAGD の運営者が実施し、監査ログに残します。</td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="px-4 py-3 text-xs leading-relaxed text-slate-500">
        管理者は、L1・L2 の項目なら申請なしで変更できます（サインが必要で、変更の記録が残ります）。L3 は管理者でも申請と 2 人の承認が必要です。
        <br />
        L2・L3 は、承認の前に「現在の値 → 新しい値」を確認画面で表示します。
      </div>
    </Card>
  );
}
