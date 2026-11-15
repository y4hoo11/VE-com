// 運行モニター（ホーム）：地図＋車両一覧＋最新のログ。普段開いておく画面
import { Link } from 'react-router-dom';
import { COL, PHASE, rosModeText, TS } from '../store/data';
import { MAP } from '../store/map';
import { emit, estop, openLog, openVehicle, S, savePrefs, task, useStore } from '../store/store';
import { MapView } from '../components/MapView';
import { Bar, Battery, Btn, Card, LvChip, VChip } from '../components/ui';
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
            <span className="text-xs font-normal text-slate-500">
              {MAP.id} ・ {MAP.width.toFixed(0)}m × {MAP.height.toFixed(0)}m
            </span>
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
          const sel = s.drawer?.type === 'vehicle' && s.drawer.id === v.id;
          const rm = rosModeText(v);
          return (
            <div
              key={v.id}
              role="button"
              tabIndex={0}
              onClick={() => openVehicle(v.id)}
              className={cx(
                'cursor-pointer rounded-lg border p-3 transition hover:border-blue-400',
                sel ? 'border-blue-500 ring-2 ring-blue-200 dark:ring-blue-900' : 'border-slate-200 dark:border-slate-700',
                v.status === 'ERROR' && 'border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/40',
                !v.online && 'opacity-60',
              )}
            >
              <div className="flex items-center gap-2">
                <b>{v.name}</b>
                <span className="text-xs text-slate-500">{v.id}</span>
                <div className="flex-1" />
                <VChip v={v} />
              </div>
              <div className="mt-1 flex gap-3 text-xs text-slate-600 dark:text-slate-300">
                <Battery v={v} />
                <span>{v.online ? fmtNum(v.speed, 1, ' m/s') : '—'}</span>
                <span>自己位置 {v.online && v.loc != null ? `${Math.round(v.loc * 100)}%` : '—'}</span>
              </div>
              <div className="mt-2 text-xs">
                {t ? (
                  <>
                    <div className="mb-1 truncate">
                      📦 {t.title} <span className="text-slate-500">{t.start} → {t.target}</span>
                    </div>
                    <Bar value={t.progress} />
                    <div className="mt-1 text-slate-500">
                      {v.paused ? '⏸ 一時停止中' : v.phase ? PHASE[v.phase] : TS[t.status]} ・ 進捗 {fmtPct(t.progress)}
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
                <div className="mt-2 truncate text-xs font-semibold text-amber-700 dark:text-amber-400">
                  ⏸ {rm.label}
                  {rm.note && `（${rm.note}）`}
                </div>
              )}
              {v.err && <div className="mt-2 truncate text-xs font-semibold text-red-600">⚠ {v.err.reason}</div>}
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
            記録をすべて見る →
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
