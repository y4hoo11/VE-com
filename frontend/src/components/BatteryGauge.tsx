import { cx } from './uiUtils';

export const LOW_BATTERY = 20; // この％以下は警告（オレンジ）。カードの背景色と共通
const CELLS = 5; // 電池のマスの数（1マス = 20%）

// 電池の絵＋数字。残量に応じてマスが減り、色も変わる
// 色: 51%以上 緑／21〜50% 黄／20%以下 オレンジ／10%以下 赤
export function BatteryGauge({ value }: { value: number | null | undefined }) {
  const has = value != null;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, Math.round(value)));
  const lit = has ? Math.ceil(pct / (100 / CELLS)) : 0; // 点灯するマスの数

  const tone = !has
    ? 'bg-slate-300'
    : pct <= 10
      ? 'bg-red-500'
      : pct <= LOW_BATTERY
        ? 'bg-orange-500'
        : pct <= 50
          ? 'bg-amber-400'
          : 'bg-green-500';

  return (
    <span className="inline-flex items-center gap-1.5" title={has ? `バッテリー ${pct}%` : 'バッテリー情報なし'}>
      <span className="flex items-center" aria-hidden="true">
        <span className="flex h-5 w-12 gap-0.5 rounded-[4px] border-2 border-slate-400 p-0.5 dark:border-slate-500">
          {Array.from({ length: CELLS }, (_, i) => (
            <span key={i} className={cx('h-full flex-1 rounded-[1px] transition-colors', i < lit ? tone : 'bg-slate-200 dark:bg-slate-700')} />
          ))}
        </span>
        <span className="h-2 w-[3px] rounded-r-sm bg-slate-400 dark:bg-slate-500" />
      </span>
      <span className="text-base font-bold tabular-nums">{has ? `${pct}%` : '—'}</span>
    </span>
  );
}