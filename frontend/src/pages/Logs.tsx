// 記録：絞り込みつきのログ一覧（サーバーで絞り込み・ページ送り）。行をクリックするとドロワーで詳細
import { useEffect, useRef, useState } from 'react';
import type { Level, Log } from '../store/data';
import { api } from '../services/api';
import { keepLogs, openLog, toast, toLog, useStore, type ApiLog } from '../store/store';
import { Btn, Card, inputCls, LvChip } from '../components/ui';
import { cx } from '../components/uiUtils';

const PAGE_SIZE = 100;
const CSV_CHUNK = 1000; // CSV 出力で1回に取る件数（API の上限）
const CSV_MAX = 100_000; // CSV 出力の上限（ブラウザが重くならないように）

type Period = 'hour' | 'day' | 'week' | 'custom' | 'all';
type Filter = { vid: string; lv: Record<Level, boolean>; period: Period; from: string; to: string; q: string };

// 画面の条件 → GET /api/logs のクエリ。どのレベルも選ばれていなければ null（取得しない）
function toParams(f: Filter): Record<string, string> | null {
  const levels = (Object.keys(f.lv) as Level[]).filter((l) => f.lv[l]);
  if (!levels.length) return null;
  const p: Record<string, string> = {};
  if (f.vid !== 'all') p.vehicleId = f.vid;
  if (levels.length < 3) p.level = levels.join(',');
  const back = { hour: 3600_000, day: 86400_000, week: 7 * 86400_000 }[f.period as 'hour' | 'day' | 'week'];
  if (back) p.from = new Date(Date.now() - back).toISOString();
  if (f.period === 'custom') {
    if (f.from) p.from = new Date(f.from).toISOString();
    if (f.to) p.to = new Date(f.to).toISOString();
  }
  if (f.q.trim()) p.q = f.q.trim();
  return p;
}

async function fetchLogs(params: Record<string, string>, offset: number, limit: number) {
  const res = await api.get<ApiLog[]>('/logs', { params: { ...params, offset, limit } });
  const total = Number(res.headers['x-total-count']);
  return { list: res.data.map(toLog), total: Number.isFinite(total) ? total : res.data.length };
}

export function Logs() {
  const s = useStore();
  const [vid, setVid] = useState('all');
  const [lv, setLv] = useState<Record<Level, boolean>>({ INFO: true, WARN: true, ERROR: true });
  const [period, setPeriod] = useState<Period>('day');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [page, setPage] = useState(0);
  const [fetchedList, setFetchedList] = useState<Log[]>([]);
  const [fetchedTotal, setFetchedTotal] = useState(0);
  const [doneKey, setDoneKey] = useState(''); // 取得が終わった条件（今の条件と違えば読み込み中）
  const [exporting, setExporting] = useState(false);
  const reqSeq = useRef(0);

  // 検索の文字は、打ち終わってから取りに行く
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const filter: Filter = { vid, lv, period, from, to, q: qDebounced };
  const key = JSON.stringify(filter);

  // 条件が変わったら1ページ目に戻す
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setPage(0);
  }

  // 新しいログが届いたら、1ページ目を見ているときだけ取り直す
  const newest = s.logs[0]?.id ?? 0;
  const refreshKey = page === 0 ? newest : 0;
  const requestKey = `${key}|${page}|${refreshKey}`;

  // どのレベルも選ばれていなければ、取得せず空で表示する
  const noLevel = !Object.values(lv).some(Boolean);
  const list = noLevel ? [] : fetchedList;
  const total = noLevel ? 0 : fetchedTotal;
  const loading = !noLevel && doneKey !== requestKey;

  useEffect(() => {
    const seq = ++reqSeq.current; // 先に進めて、取得中の古い結果を捨てる
    const params = toParams(filter);
    if (!params) return;
    const t = setTimeout(() => {
      fetchLogs(params, page * PAGE_SIZE, PAGE_SIZE)
        .then((r) => {
          if (seq !== reqSeq.current) return; // 古い条件の結果は捨てる
          keepLogs(r.list);
          setFetchedList(r.list);
          setFetchedTotal(r.total);
        })
        .catch((e) => {
          if (seq !== reqSeq.current) return;
          console.error('ログの取得に失敗しました:', e);
          toast('ログの取得に失敗しました', 'error');
        })
        .finally(() => {
          if (seq === reqSeq.current) setDoneKey(requestKey);
        });
    }, 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, page, refreshKey]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total ? page * PAGE_SIZE + 1 : 0;
  const last = Math.min(total, (page + 1) * PAGE_SIZE);

  const exportCsv = async () => {
    const params = toParams(filter);
    if (!params || !total) return toast('出力するログがありません', 'warn');
    setExporting(true);
    try {
      const all: Log[] = [];
      for (let off = 0; off < Math.min(total, CSV_MAX); off += CSV_CHUNK) {
        const r = await fetchLogs(params, off, CSV_CHUNK);
        all.push(...r.list);
        if (r.list.length < CSV_CHUNK) break;
      }
      downloadCsv(all, s.vehicles);
      if (total > CSV_MAX) toast(`件数が多いため、新しい順に ${CSV_MAX.toLocaleString()} 件までを出力しました`, 'warn');
    } catch (e) {
      console.error('CSV 出力に失敗しました:', e);
      toast('CSV 出力のためのログの取得に失敗しました', 'error');
    } finally {
      setExporting(false);
    }
  };

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
        </select>
        <div className="flex gap-3 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800">
          {(['INFO', 'WARN', 'ERROR'] as Level[]).map((l) => (
            <label key={l} className="flex items-center gap-1">
              <input type="checkbox" checked={lv[l]} onChange={(e) => setLv({ ...lv, [l]: e.target.checked })} />
              {l}
            </label>
          ))}
        </div>
        <select className={cx(inputCls, 'w-36')} value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
          <option value="hour">直近1時間</option>
          <option value="day">直近24時間</option>
          <option value="week">直近7日</option>
          <option value="custom">期間を指定</option>
          <option value="all">すべて</option>
        </select>
        {period === 'custom' && (
          <div className="flex items-center gap-1.5 text-sm">
            <input type="datetime-local" className={cx(inputCls, 'w-52')} value={from} onChange={(e) => setFrom(e.target.value)} />
            〜
            <input type="datetime-local" className={cx(inputCls, 'w-52')} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
        <input className={cx(inputCls, 'w-64')} placeholder="メッセージで検索" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex-1" />
        <span className="text-sm text-slate-500">
          {total.toLocaleString()}件{loading && ' ・ 読み込み中…'}
        </span>
        <Btn disabled={exporting || !total} onClick={exportCsv}>
          {exporting ? '出力中…' : '⬇ CSV出力'}
        </Btn>
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
            {list.map((l) => (
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
        {!list.length && !loading && <div className="py-12 text-center text-slate-400">条件に合うログはありません</div>}
      </Card>
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <Btn size="sm" disabled={page === 0} onClick={() => setPage(0)}>
            « 最初
          </Btn>
          <Btn size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            ‹ 前へ
          </Btn>
          <span className="px-2 text-slate-500">
            {first.toLocaleString()}〜{last.toLocaleString()}件目（{page + 1} / {pages} ページ）
          </span>
          <Btn size="sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            次へ ›
          </Btn>
          <Btn size="sm" disabled={page >= pages - 1} onClick={() => setPage(pages - 1)}>
            最後 »
          </Btn>
        </div>
      )}
    </div>
  );
}

// 条件に合うログを CSV で保存する（Excel で開けるよう BOM 付き UTF-8）
function downloadCsv(list: Log[], vehicles: { id: string; name: string }[]) {
  if (!list.length) return toast('出力するログがありません', 'warn');
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [
    ['日時', 'レベル', '車両ID', '車両名', 'メッセージ', '詳細'],
    ...list.map((l) => [
      new Date(l.at).toLocaleString('ja-JP'),
      l.level,
      l.vid ?? '',
      vehicles.find((v) => v.id === l.vid)?.name ?? '',
      l.message,
      l.details ? JSON.stringify(l.details) : '',
    ]),
  ];
  const csv = '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  const d = new Date();
  a.href = url;
  a.download = `ve-con_logs_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`${list.length.toLocaleString()}件のログを CSV で保存しました`, 'ok');
}
