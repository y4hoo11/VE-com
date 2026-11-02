// 横から出てくるパネル（車両・タスク・ログ）。車両の中身は車両詳細ページでも使う
import type { ReactNode } from 'react';
import { ERR, PHASE, wpByName, type Vehicle } from '../mock/data';
import {
  askCancel,
  askClear,
  askHome,
  closeDrawer,
  confirmLoad,
  estop,
  nav,
  openModal,
  openTask,
  openVehicle,
  pause,
  resume,
  S,
  startMapMode,
  task,
  useStore,
  veh,
} from '../mock/store';
import { Bar, Battery, Btn, cx, fmtDT, fmtT, Kv, LvChip, PrioChip, Section, Tag, TChip, TS_DOT, VChip } from './ui';

export function DrawerHost() {
  const s = useStore();
  const d = s.drawer;
  let title: ReactNode = null;
  let body: ReactNode = null;
  if (d?.type === 'vehicle') {
    const v = veh(d.id);
    if (v) {
      title = (
        <>
          {v.name} <span className="text-sm font-normal text-slate-500">{v.id}</span>
        </>
      );
      body = <VehiclePanel v={v} inDrawer />;
    }
  } else if (d?.type === 'task') {
    const t = task(d.id);
    if (t) {
      title = (
        <>
          {t.id} <span className="text-sm font-normal text-slate-500">タスク</span>
        </>
      );
      body = <TaskBody id={t.id} />;
    }
  } else if (d?.type === 'log') {
    title = 'ログの詳細';
    body = <LogBody id={Number(d.id)} />;
  }
  const open = !!d && !!body;
  return (
    <aside
      className={cx(
        'absolute top-0 right-0 bottom-0 z-[150] flex w-[400px] flex-col border-l border-slate-200 bg-white shadow-[-8px_0_24px_rgba(0,0,0,0.12)] transition-transform duration-200 dark:border-slate-700 dark:bg-slate-900',
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
      )}
    >
      <div className="flex items-center border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <div className="text-base font-bold">{title}</div>
        <div className="flex-1" />
        <button type="button" onClick={closeDrawer} className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="閉じる">
          ✕
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-auto p-4">{body}</div>
    </aside>
  );
}

// ---------------------------------------------------------------
// 車両（ドロワーと車両詳細ページで共通）
// ---------------------------------------------------------------
export function VehiclePanel({ v, inDrawer }: { v: Vehicle; inDrawer?: boolean }) {
  useStore();
  const t = task(v.taskId);
  const canMove = v.online && v.status !== 'ERROR';
  const stopped = v.status !== 'RUNNING' || v.paused;
  const vbat = v.battery == null ? '' : `（${(6.6 + v.battery * 0.0135).toFixed(2)} V）`;
  const off = !v.online;

  return (
    <>
      <div className="flex items-center gap-3">
        <VChip v={v} />
        <Battery v={v} />
        <span className="ml-auto text-xs text-slate-500">最終受信 {off ? '—' : fmtT(v.lastHb)}</span>
      </div>

      {v.err && (
        <div className={cx('rounded-lg border p-3 text-sm', v.err.latched ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950' : 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950')}>
          <div className="font-bold text-red-700 dark:text-red-300">⚠ {ERR[v.err.code] ?? v.err.code}</div>
          <div className="mt-0.5">{v.err.reason}</div>
          <div className="mt-1 text-xs text-slate-500">
            {v.err.code} / {v.err.source} / {fmtT(v.err.at)} ・ {v.err.latched ? '解除の操作が必要' : '原因がなくなれば自動で戻ります'}
          </div>
          {v.err.latched && (
            <Btn size="sm" variant="danger" op className="mt-2" onClick={() => askClear(v.id)}>
              安全を確認して解除…
            </Btn>
          )}
          {v.err.code === 'LOCALIZATION_LOST' && (
            <Btn size="sm" op className="mt-2" onClick={() => startMapMode('pose', v.id)}>
              🎯 現在地を設定する
            </Btn>
          )}
        </div>
      )}
      {off && <div className="rounded-lg bg-slate-100 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">車両からデータが届いていません（OFFLINE）。電源とネットワークを確認してください。操作はできません。</div>}

      <Section title="車両データ">
        <Kv
          rows={[
            ['位置', off ? '—' : `x ${v.x.toFixed(2)} / y ${v.y.toFixed(2)} m`],
            ['向き', off ? '—' : `${Math.round((v.theta * 180) / Math.PI)}°`],
            ['速度', off ? '—' : `${v.speed.toFixed(2)} m/s`],
            ['自己位置の確かさ', off ? '—' : <span className={cx(v.loc < 0.6 && 'font-bold text-red-600')}>{Math.round(v.loc * 100)}%</span>],
            ['バッテリー', v.battery == null ? '—' : `${Math.round(v.battery)}% ${vbat}`],
            ['ラズパイ温度', off ? '—' : `${v.piTemp.toFixed(1)} ℃`],
            ['ESP32 / LiDAR', off ? '—' : `${v.esp32 ? '正常' : '異常'} / ${v.lidarHz} Hz`],
            ['行き先', v.goal ? `${v.goal}${wpByName(v.goal) ? `（${wpByName(v.goal)!.label}）` : ''}` : '—'],
          ]}
        />
      </Section>

      <Section title="実行中のタスク">
        {t ? (
          <div className="space-y-2">
            <button type="button" className="text-left font-semibold text-blue-600 hover:underline" onClick={() => openTask(t.id)}>
              {t.id} {t.title}
            </button>
            <div className="text-xs text-slate-500">
              {t.start} → {t.target}
            </div>
            <Bar value={t.progress} className="h-2" />
            <div className="text-xs">
              {v.paused ? '⏸ 一時停止中' : v.phase ? PHASE[v.phase] : ''} ・ {Math.round(t.progress)}%
            </div>
            <div className="flex flex-wrap gap-2">
              {v.paused ? (
                <Btn size="sm" variant="pri" op disabled={v.status === 'ERROR'} onClick={() => resume(v.id)}>
                  ▶ 再開
                </Btn>
              ) : (
                <Btn size="sm" op disabled={!canMove} onClick={() => pause(v.id)}>
                  ⏸ 一時停止
                </Btn>
              )}
              <Btn size="sm" op disabled={!canMove || v.wait <= 0} title="荷積み・荷降ろしが終わったら押す" onClick={() => confirmLoad(v.id)}>
                ✓ 積み降ろし完了
              </Btn>
              <Btn size="sm" variant="dangerO" op onClick={() => askCancel(t.id)}>
                中止…
              </Btn>
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-400">{v.mode === 'GOTO' ? `${v.goal} へ移動中（タスクではない移動）` : 'タスクはありません'}</div>
        )}
      </Section>

      {S.user.role !== 'VIEWER' && (
        <Section title="移動の指示">
          <div className="flex flex-wrap gap-2">
            <Btn size="sm" disabled={!canMove || !!t} onClick={() => startMapMode('goto', v.id)}>
              📍 地点へ移動
            </Btn>
            <Btn size="sm" disabled={!canMove || !!t} onClick={() => askHome(v.id)}>
              🏠 ホームへ戻る
            </Btn>
            <Btn size="sm" disabled={off || !stopped} title="止まっているときだけ設定できます" onClick={() => startMapMode('pose', v.id)}>
              🎯 現在地を設定
            </Btn>
          </div>
          {t && <div className="mt-1.5 text-xs text-slate-400">タスクの実行中は移動の指示を出せません</div>}
        </Section>
      )}

      <button
        type="button"
        disabled={off || v.status === 'ERROR'}
        onClick={() => estop(v.id)}
        className="w-full rounded-lg bg-red-600 py-3.5 text-base font-extrabold tracking-wider text-white hover:bg-red-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-red-300 dark:disabled:bg-red-950"
      >
        {v.status === 'ERROR' ? '停止中' : `■ ${v.name} を緊急停止`}
      </button>

      {inDrawer && (
        <button type="button" className="block text-sm text-blue-600 hover:underline" onClick={() => nav(`/vehicles/${v.id}`)}>
          カメラ映像・詳細ページを開く →
        </button>
      )}
    </>
  );
}

// ---------------------------------------------------------------
// タスク
// ---------------------------------------------------------------
function TaskBody({ id }: { id: string }) {
  useStore();
  const t = task(id)!;
  const v = veh(t.vehicleId);
  const active = t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS';
  const sw = wpByName(t.start);
  const tw = wpByName(t.target);
  return (
    <>
      <div>
        <div className="text-lg font-bold">{t.title}</div>
        <div className="mt-1 flex items-center gap-2">
          <TChip s={t.status} />
          <PrioChip p={t.priority} />
        </div>
      </div>
      {active && (
        <div className="space-y-1.5 rounded-lg bg-blue-50 p-3 dark:bg-blue-950/50">
          <Bar value={t.progress} className="h-2" />
          <div className="text-xs">
            {v?.status === 'ERROR' ? '⚠ 車両が異常で止まっています' : v?.paused ? '⏸ 一時停止中' : v?.phase ? PHASE[v.phase] : '出発待ち'} ・ {Math.round(t.progress)}%
          </div>
        </div>
      )}
      <Section title="内容">
        <Kv
          rows={[
            ['出発地', `${t.start}（${sw?.label ?? '?'}）`],
            ['目的地', `${t.target}（${tw?.label ?? '?'}）`],
            [
              '車両',
              v ? (
                <button type="button" className="text-blue-600 hover:underline" onClick={() => openVehicle(v.id)}>
                  {v.name}（{v.id}）
                </button>
              ) : (
                '—'
              ),
            ],
            ['予定日時', fmtDT(t.scheduledAt)],
            ['作成', `${t.createdBy} ・ ${fmtDT(t.createdAt)}`],
            ['開始', fmtDT(t.startedAt)],
            ['終了', fmtDT(t.completedAt)],
          ]}
        />
      </Section>
      <div className="flex flex-wrap gap-2">
        {t.status === 'PENDING' && (
          <>
            <Btn size="sm" variant="pri" op onClick={() => openModal({ kind: 'assign', taskId: t.id })}>
              車両を割り当てる
            </Btn>
            <Btn size="sm" op onClick={() => openModal({ kind: 'taskForm', mode: 'edit', taskId: t.id })}>
              編集
            </Btn>
            <Btn size="sm" variant="dangerO" op onClick={() => askCancel(t.id)}>
              取り消し…
            </Btn>
          </>
        )}
        {active && (
          <Btn size="sm" variant="dangerO" op onClick={() => askCancel(t.id)}>
            中止…
          </Btn>
        )}
      </div>
      <Section title="状態の変化">
        <ol className="relative ml-1 space-y-3 border-l-2 border-slate-200 pl-4 dark:border-slate-700">
          {[...t.history].reverse().map((h, i) => (
            <li key={i} className="relative">
              <span className={cx('absolute top-1 -left-[23px] h-3 w-3 rounded-full ring-2 ring-white dark:ring-slate-900', TS_DOT[h.status])} />
              <div className="flex items-center gap-2">
                <TChip s={h.status} />
                <span className="text-xs text-slate-500">{fmtDT(h.at)}</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{h.note}</div>
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------
// ログ
// ---------------------------------------------------------------
function LogBody({ id }: { id: number }) {
  useStore();
  const l = S.logs.find((x) => x.id === id);
  if (!l) return <div className="text-slate-400">このログは見つかりません</div>;
  const v = veh(l.vid);
  return (
    <>
      <div className="flex items-center gap-2">
        <LvChip l={l.level} />
        <span className="text-sm text-slate-500">{new Date(l.at).toLocaleString('ja-JP')}</span>
      </div>
      <div className="text-base font-medium">{l.message}</div>
      <Kv
        rows={[
          ['車両', v ? <button type="button" className="text-blue-600 hover:underline" onClick={() => openVehicle(v.id)}>{v.name}（{v.id}）</button> : l.vid ?? 'システム'],
          ['ログID', l.id],
        ]}
      />
      <Section title="詳細データ（details）">
        {l.details ? (
          <pre className="overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-green-300">{JSON.stringify(l.details, null, 2)}</pre>
        ) : (
          <div className="text-sm text-slate-400">
            なし <Tag>details は空</Tag>
          </div>
        )}
      </Section>
    </>
  );
}
