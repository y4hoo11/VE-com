// 記録：絞り込みつきのログ一覧。行をクリックするとドロワーで詳細
import { useState } from 'react';
import type { Level } from '../mock/data';
import { openLog, toast, useStore } from '../mock/store';
import { Btn, Card, cx, inputCls, LvChip } from '../components/ui';

export function Logs() {
  const s = useStore();
  const [vid, setVid] = useState('all');
  const [lv, setLv] = useState<Record<Level, boolean>>({ INFO: true, WARN: true, ERROR: true });
  const [period, setPeriod] = useState('day');
  const [q, setQ] = useState('');
  const since = { hour: Date.now() - 3600_000, day: Date.now() - 86400_000, all: 0 }[period] ?? 0;
  const list = s.logs.filter(
    (l) => (vid === 'all' || (vid === 'system' ? !l.vid : l.vid === vid)) && lv[l.level] && l.at >= since && (!q || l.message.includes(q)),
  );

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="m-0 mr-2 text-xl font-bold whitespace-nowrap">記録</h2>
        <select className={cx(inputCls, 'w-40')} value={vid} onChange={(e) => setVid(e.target.value)}>
          <option value="all">すべての車両</option>
          {s.vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}（{v.id}）
            </option>
          ))}
          <option value="system">システム</option>
        </select>
        <div className="flex gap-3 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800">
          {(['INFO', 'WARN', 'ERROR'] as Level[]).map((l) => (
            <label key={l} className="flex items-center gap-1">
              <input type="checkbox" checked={lv[l]} onChange={(e) => setLv({ ...lv, [l]: e.target.checked })} />
              {l}
            </label>
          ))}
        </div>
        <select className={cx(inputCls, 'w-36')} value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="hour">直近1時間</option>
          <option value="day">直近24時間</option>
          <option value="all">すべて</option>
        </select>
        <input className={cx(inputCls, 'w-64')} placeholder="メッセージで検索" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex-1" />
        <span className="text-sm text-slate-500">{list.length}件</span>
        <Btn onClick={() => toast('モックでは CSV を出力しません（本番では表示中の条件で出力）')}>⬇ CSV出力</Btn>
      </div>
      <Card bodyClass="overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500 dark:bg-slate-800">
            <tr>
              <th className="w-44 px-4 py-2">日時</th>
              <th className="w-20 py-2">レベル</th>
              <th className="w-28 py-2">車両</th>
              <th className="py-2">メッセージ</th>
              <th className="w-16 py-2" />
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 300).map((l) => (
              <tr
                key={l.id}
                onClick={() => openLog(l.id)}
                className={cx('cursor-pointer border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800', s.drawer?.type === 'log' && s.drawer.id === String(l.id) && 'bg-blue-50 dark:bg-blue-950')}
              >
                <td className="px-4 py-1.5 text-slate-500">{new Date(l.at).toLocaleString('ja-JP')}</td>
                <td className="py-1.5">
                  <LvChip l={l.level} />
                </td>
                <td className="py-1.5 text-slate-600 dark:text-slate-300">{s.vehicles.find((v) => v.id === l.vid)?.name ?? l.vid ?? 'システム'}</td>
                <td className="py-1.5">{l.message}</td>
                <td className="py-1.5 text-xs text-slate-400">{l.details ? '{ }' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <div className="py-12 text-center text-slate-400">条件に合うログはありません</div>}
      </Card>
    </div>
  );
}
