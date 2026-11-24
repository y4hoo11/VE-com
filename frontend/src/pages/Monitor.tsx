// 運行モニター（ホーム）：地図＋車両一覧＋最新のログ。普段開いておく画面
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { COL, PAUSED_COL, PHASE, rosModeText, TS, type Vehicle } from '../store/data';
import { hasMap, MAP } from '../store/map';
import { emit, estop, openLog, openVehicle, pickMap, S, savePrefs, task, useStore } from '../store/store';
import { MapView } from '../components/MapView';
import { Bar, Btn, Card, LvChip, Tag, VChip } from '../components/ui';
import { BatteryGauge, LOW_BATTERY } from '../components/BatteryGauge';
import { cx, fmtNum, fmtPct, fmtT } from '../components/uiUtils';

export function Monitor() {
  const s = useStore();
  const toggle = (k: keyof typeof S.view) => (
    <label className="flex items-center gap-1 text-xs font-normal text-slate-600 dark:text-slate-300">
      <input
        type="checkbox"
        checked={s.view[k]}
        onChange={(e) => {
          s.view[k] = e.target.checked;
          savePrefs();
          emit();
        }}
      />
      {{ grid: '方眼', path: '経路', labels: '地点名' }[k]}
    </label>
  );

  return (
    <div className="grid h-full grid-cols-[1fr_340px] grid-rows-[1fr_190px] gap-3 p-3">
      <Card
        title={
          <>
            倉庫マップ
            <MapSwitch />
          </>
        }
        right={
          <div className="flex items-center gap-4">
            {toggle('path')}
            {toggle('labels')}
            {toggle('grid')}
            <span className="flex gap-2.5 text-xs font-normal text-slate-500">
              {(['RUNNING', 'IDLE', 'CHARGING', 'ERROR', 'OFFLINE'] as const).map((k) => (
                <span key={k} className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ background: COL[k] }} />
                  {{ RUNNING: '稼働', IDLE: '待機', CHARGING: '充電', ERROR: '異常', OFFLINE: 'オフライン' }[k]}
                </span>
              ))}
            </span>
          </div>
        }
        bodyClass="relative"
      >
        <MapView mapKey="main" />
        <OtherMapBanner />
      </Card>

      <Card
        title={
          <>
            車両<span className="text-xs font-normal text-slate-500">{s.vehicles.length}台</span>
          </>
        }
        bodyClass="overflow-auto p-2 space-y-2"
      >
        {s.vehicles.map((v) => {
          const t = task(v.taskId);
          const otherMap = !!v.mapId && v.mapId !== MAP.id;
          const sel = s.drawer?.type === 'vehicle' && s.drawer.id === v.id;
          const rm = rosModeText(v);
          const col = v.paused && v.status === 'RUNNING' ? PAUSED_COL : COL[v.status]; // 地図の車両と同じ色
          const lowBattery = v.battery != null && v.battery <= LOW_BATTERY;
          return (
            <div
              key={v.id}
              role="button"
              tabIndex={0}
              onClick={() => openVehicle(v.id)}
              style={{ borderColor: col }}
              className={cx(
                'cursor-pointer rounded-lg border-2 p-3 transition hover:shadow-md',
                sel && 'ring-2 ring-blue-300 dark:ring-blue-800',
                v.status === 'ERROR' && 'bg-red-50/60 dark:bg-red-950/40',
                v.status !== 'ERROR' && lowBattery && 'bg-orange-100 dark:bg-orange-900/40',
                !v.online && 'border-dashed opacity-60',
              )}
            >
              <div className="flex items-center gap-2">
                <b className="text-lg">{v.name}</b>
                <span className="text-sm text-slate-500">{v.id}</span>
                {(otherMap || mapsInUse(s.vehicles).size > 1) && v.mapId && <Tag tone={otherMap ? 'amber' : 'gray'}>{v.mapId}</Tag>}
                <div className="flex-1" />
                <VChip v={v} />
              </div>
              <div className="mt-2 flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                <BatteryGauge value={v.battery} />
                <span>{v.online ? fmtNum(v.speed, 1, ' m/s') : '—'}</span>
                <span>自己位置 {v.online && v.loc != null ? `${Math.round(v.loc * 100)}%` : '—'}</span>
              </div>
              <div className="mt-2 text-sm">
                {t ? (
                  <>
                    <div className="mb-1 truncate">
                      {t.title} <span className="text-slate-500">{t.start} → {t.target}</span>
                    </div>
                    <Bar value={t.progress} />
                    <div className="mt-1 text-slate-500">
                      {v.paused ? '一時停止中' : v.phase ? PHASE[v.phase] : TS[t.status]} ・ 進捗 {fmtPct(t.progress)}
                    </div>
                  </>
                ) : v.mode === 'GOTO' ? (
                  <span className="text-slate-500">→ {v.goal} へ移動中</span>
                ) : (
                  <span className="text-slate-400">タスクなし</span>
                )}
              </div>
              {/* 止まっている理由など、気にした方がよい動作だけ出す（移動中・荷待ちは上の表示でわかる） */}
              {!v.err && rm?.tone === 'warn' && (
                <div className="mt-2 truncate text-sm font-semibold text-amber-700 dark:text-amber-400">
                  ⏸ {rm.label}
                  {rm.note && `（${rm.note}）`}
                </div>
              )}
              {v.err && <div className="mt-2 truncate text-sm font-semibold text-red-600">⚠ {v.err.reason}</div>}
              <div className="mt-2 flex justify-end">
                <Btn
                  size="sm"
                  variant="dangerO"
                  disabled={!v.online || v.status === 'ERROR'}
                  onClick={(e) => {
                    e.stopPropagation();
                    estop(v.id);
                  }}
                >
                  ■ 停止
                </Btn>
              </div>
            </div>
          );
        })}
      </Card>

      <Card
        className="col-span-2"
        title="最新のログ"
        right={
          <Link to="/logs" className="text-sm font-normal text-blue-600 hover:underline">
            記録をすべて見る
          </Link>
        }
        bodyClass="overflow-auto"
      >
        <table className="w-full text-sm">
          <tbody>
            {s.logs.slice(0, 8).map((l) => (
              <tr key={l.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800" onClick={() => openLog(l.id)}>
                <td className="w-20 px-4 py-1.5 text-slate-500">{fmtT(l.at)}</td>
                <td className="w-16 py-1.5">
                  <LvChip l={l.level} />
                </td>
                <td className="w-20 py-1.5 text-slate-500">{l.vid ?? 'システム'}</td>
                <td className="py-1.5">{l.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// 車両が使っている地図ごとの車両（地図が分からない車両は入れない）
function mapsInUse(vs: Vehicle[]) {
  const m = new Map<string, Vehicle[]>();
  vs.forEach((v) => {
    if (v.mapId) m.set(v.mapId, [...(m.get(v.mapId) ?? []), v]);
  });
  return m;
}

// 地図の見出し：使われている地図が1つなら名前と大きさ、複数なら押して切り替えられる一覧（台数つき）
function MapSwitch() {
  const s = useStore();
  const used = mapsInUse(s.vehicles);
  // 地図が1つだけのときは何も出さない（地図名と大きさの表記はなくした）
  if (used.size === 0 || (used.size === 1 && used.has(MAP.id))) return null;
  const ids = used.has(MAP.id) ? [...used.keys()] : [MAP.id, ...used.keys()];
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {ids.map((id) => {
        const on = id === MAP.id;
        const n = used.get(id)?.length ?? 0;
        return (
          <button
            key={id}
            type="button"
            disabled={!hasMap(id)}
            title={hasMap(id) ? undefined : 'Web に入っていない地図です。Web を起動し直してください'}
            onClick={() => pickMap(id)}
            className={cx(
              'rounded-full border px-2.5 py-0.5 text-xs font-semibold disabled:opacity-50',
              on ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300' : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800',
            )}
          >
            {id}（{n}台）
          </button>
        );
      })}
    </span>
  );
}

// 表示中と違う地図の車両があれば、地図の上に帯を出す。✕ で消せる
// （消したあとでも、その地図を使う車両が増えたり減ったりしたら、もう一度出す。画面を移ると元に戻る）
function OtherMapBanner() {
  const s = useStore();
  const [closed, setClosed] = useState<string[]>([]);
  const others = [...mapsInUse(s.vehicles)]
    .filter(([id]) => id !== MAP.id)
    .map(([id, vs]) => ({ id, vs, key: `${id}:${vs.map((v) => v.id).join(',')}` }))
    .filter((o) => !closed.includes(o.key));
  if (!others.length) return null;
  return (
    <div className="absolute top-2 right-14 left-2 z-10 space-y-1">
      {others.map(({ id, vs, key }) => (
        <div key={id} className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50/95 px-3 py-1.5 text-sm text-amber-900 shadow-sm dark:border-amber-800 dark:bg-amber-950/95 dark:text-amber-200">
          <span className="min-w-0 truncate">
            {vs.map((v) => v.name).join('、')} は <b>{id}</b> を使っています
          </span>
          {hasMap(id) ? (
            <Btn size="sm" className="ml-auto" onClick={() => pickMap(id)}>
              この地図を表示
            </Btn>
          ) : (
            <span className="ml-auto text-xs">Web に入っていない地図です。Web を起動し直してください</span>
          )}
          <button
            type="button"
            aria-label="このお知らせを閉じる"
            title="閉じる"
            onClick={() => setClosed((c) => [...c, key])}
            className="shrink-0 rounded px-1.5 py-0.5 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
