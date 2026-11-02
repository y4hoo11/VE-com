// タスク：状態ごとのタブ＋一覧。作成・割り当てはモーダル、詳細はドロワー
import { useState } from 'react';
import type { Task } from '../mock/data';
import { askCancel, openModal, openTask, useStore, veh } from '../mock/store';
import { Bar, Btn, Card, cx, fmtDT, inputCls, PrioChip, TChip } from '../components/ui';

const TABS: [string, string, (t: Task) => boolean][] = [
  ['open', '未完了', (t) => ['PENDING', 'ASSIGNED', 'IN_PROGRESS'].includes(t.status)],
  ['pending', '未割当', (t) => t.status === 'PENDING'],
  ['running', '実行中', (t) => t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS'],
  ['done', '完了', (t) => t.status === 'COMPLETED'],
  ['ng', '失敗・取消', (t) => t.status === 'FAILED' || t.status === 'CANCELLED'],
  ['all', 'すべて', () => true],
];
const ORDER: Record<string, number> = { IN_PROGRESS: 0, ASSIGNED: 1, PENDING: 2 };

export function Tasks() {
  const s = useStore();
  const [tab, setTab] = useState('open');
  const [q, setQ] = useState('');
  const f = TABS.find((x) => x[0] === tab)![2];
  const list = s.tasks
    .filter(f)
    .filter((t) => !q || (t.id + t.title + t.start + t.target).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3) || b.priority - a.priority || b.createdAt - a.createdAt);

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center gap-4">
        <h2 className="m-0 shrink-0 text-xl font-bold whitespace-nowrap">タスク</h2>
        <div className="flex shrink-0 rounded-lg bg-slate-200 p-1 whitespace-nowrap dark:bg-slate-800">
          {TABS.map(([k, label, fn]) => (
            <button
              type="button"
              key={k}
              onClick={() => setTab(k)}
              className={cx('flex items-center gap-1.5 rounded-md px-3 py-1 text-sm', tab === k ? 'bg-white font-bold shadow dark:bg-slate-700' : 'text-slate-600 dark:text-slate-400')}
            >
              {label}
              <span className="rounded-full bg-slate-300/70 px-1.5 text-[11px] dark:bg-slate-600">{s.tasks.filter(fn).length}</span>
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <input className={cx(inputCls, 'max-w-64 min-w-32')} placeholder="ID・タイトル・地点で検索" value={q} onChange={(e) => setQ(e.target.value)} />
        <Btn variant="pri" op className="shrink-0" onClick={() => openModal({ kind: 'taskForm', mode: 'create' })}>
          ＋ 新しいタスク
        </Btn>
      </div>

      <Card bodyClass="overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500 dark:bg-slate-800">
            <tr>
              {['ID', 'タイトル', '出発地 → 目的地', '優先度', '状態', '車両', '進捗', '予定', ''].map((h) => (
                <th key={h} className="px-3 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((t) => {
              const v = veh(t.vehicleId);
              const active = t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS';
              const sel = s.drawer?.type === 'task' && s.drawer.id === t.id;
              return (
                <tr key={t.id} onClick={() => openTask(t.id)} className={cx('cursor-pointer border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800', sel && 'bg-blue-50 dark:bg-blue-950')}>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">{t.id}</td>
                  <td className="px-3 py-2 font-medium">{t.title}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                    {t.start} → {t.target}
                  </td>
                  <td className="px-3 py-2">
                    <PrioChip p={t.priority} />
                  </td>
                  <td className="px-3 py-2">
                    <TChip s={t.status} />
                    {active && v?.status === 'ERROR' && <span className="ml-1 text-xs font-bold text-red-600">⚠車両異常</span>}
                    {active && v?.paused && v.status !== 'ERROR' && <span className="ml-1 text-xs text-amber-600">⏸</span>}
                  </td>
                  <td className="px-3 py-2">{v?.name ?? <span className="text-slate-400">—</span>}</td>
                  <td className="w-36 px-3 py-2">
                    {active ? (
                      <div className="flex items-center gap-2">
                        <Bar value={t.progress} className="flex-1" />
                        <span className="w-9 text-right text-xs">{Math.round(t.progress)}%</span>
                      </div>
                    ) : t.status === 'COMPLETED' ? (
                      <span className="text-xs text-slate-500">100%</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">{fmtDT(t.scheduledAt)}</td>
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    {t.status === 'PENDING' && (
                      <Btn size="sm" variant="pri" op onClick={() => openModal({ kind: 'assign', taskId: t.id })}>
                        割り当て
                      </Btn>
                    )}
                    {active && (
                      <Btn size="sm" variant="dangerO" op onClick={() => askCancel(t.id)}>
                        中止
                      </Btn>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!list.length && <div className="py-12 text-center text-slate-400">該当するタスクはありません</div>}
      </Card>
    </div>
  );
}
