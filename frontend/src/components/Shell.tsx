// どの画面にも出るもの：ヘッダー・異常のお知らせ帯・ポップオーバー・トースト
import { useEffect, type MouseEvent } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ERR, wpByName } from '../store/data';
import {
  askClear,
  closePop,
  emit,
  estop,
  logout,
  nav,
  openModal,
  openVehicle,
  stopAll,
  task,
  togglePop,
  useStore,
  veh,
} from '../store/store';
import { Battery, Btn, Tag, VChip } from './ui';
import { cx, fmtDT, fmtNum, fmtPct, fmtT } from './uiUtils';

// ---------------------------------------------------------------
// ヘッダー
// ---------------------------------------------------------------
export function Header() {
  const s = useStore();
  const loc = useLocation();
  const unread = s.notes.filter((n) => !n.read).length;
  const pop = (kind: 'conn' | 'bell' | 'user') => (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    togglePop({ kind, x: r.right, y: r.bottom + 6, right: true });
  };
  const links: [string, string][] = [
    ['/', '運行モニター'],
    ['/tasks', 'タスク'],
    ['/logs', '記録'],
    ['/map', '地図・地点'],
    ['/settings', '設定'],
  ];
  const hdBtn = 'flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1.5 text-sm text-slate-200 hover:bg-slate-800';

  return (
    <header className="relative z-[300] flex h-13 shrink-0 items-center gap-6 bg-slate-900 px-4 text-white">
      <div className="flex items-baseline gap-2 text-lg font-extrabold tracking-wide">
        VE-con<span className="text-xs font-normal text-slate-400">AGV運行管理</span>
      </div>
      <nav className="flex h-full">
        {links.map(([to, label]) => {
          const active = to === '/' ? loc.pathname === '/' || loc.pathname.startsWith('/vehicles') : loc.pathname.startsWith(to);
          return (
            <NavLink key={to} to={to} className={cx('flex items-center border-b-[3px] px-3.5 text-sm', active ? 'border-blue-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200')}>
              {label}
            </NavLink>
          );
        })}
      </nav>
      <div className="flex-1" />
      <button type="button" data-pop-trigger className={hdBtn} onClick={pop('conn')}>
        <span className={cx('h-2 w-2 rounded-full', s.server && s.mqtt ? 'bg-green-400' : 'animate-pulse bg-red-500')} />
        {s.demo ? 'デモ' : !s.server ? 'サーバー切断' : s.mqtt ? '接続中' : 'MQTT切断'}
      </button>
      <button type="button" data-pop-trigger className={cx(hdBtn, 'relative')} onClick={pop('bell')} aria-label="通知">
        🔔
        {unread > 0 && <span className="absolute -top-1.5 -right-1.5 rounded-full bg-red-600 px-1.5 text-[11px] font-bold">{unread}</span>}
      </button>
      <button type="button" data-pop-trigger className={hdBtn} onClick={pop('user')}>
        👤 {s.user.name}
        <span className="rounded bg-slate-700 px-1.5 text-[11px]">{s.user.role}</span>
      </button>
      <button
        type="button"
        onClick={stopAll}
        title="全車両に緊急停止を送ります（確認なし）"
        className="rounded-md bg-red-600 px-5 py-2 text-sm font-extrabold tracking-wider text-white shadow-[0_0_0_3px_rgba(220,38,38,0.35)] hover:bg-red-700 active:scale-95"
      >
        ■ 全車停止
      </button>
    </header>
  );
}

// ---------------------------------------------------------------
// 異常のお知らせ帯（モーダルを開いていても隠れない）
// ---------------------------------------------------------------
export function AlertBanner() {
  const s = useStore();
  const errs = s.vehicles.filter((v) => v.status === 'ERROR' && v.err);
  if (s.server && s.mqtt && !errs.length && !s.demo) return null;
  return (
    <div className="relative z-[300] shrink-0">
      {/* 【仮】デモモードの表示。実データと見間違えないよう、どの画面でも出す */}
      {s.demo && (
        <div className="flex items-center gap-3 border-b border-violet-300 bg-violet-100 px-4 py-2 text-sm text-violet-900 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200">
          🧪 <b>デモモード</b>
          <span>表示は実データではありません。操作はサーバー・実機に送られません。</span>
          <a href="#/settings/demo" className="ml-auto underline">
            設定で切り替え
          </a>
        </div>
      )}
      {!s.server && (
        <div className="flex items-center gap-3 border-b border-red-300 bg-red-50 px-4 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          ⚠ <b>サーバーとの接続が切れています</b>
          <span>画面の表示は最新ではありません。再接続を試みています。</span>
        </div>
      )}
      {s.server && !s.mqtt && (
        <div className="flex items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          ⚠ <b>MQTTブローカーと切断中</b>
          <span>車両の表示は最新ではありません。送った命令は再接続まで車両に届きません。</span>
        </div>
      )}
      {errs.map((v) => (
        <div
          key={v.id}
          className={cx(
            'flex items-center gap-3 border-b px-4 py-2 text-sm',
            v.err!.latched ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200' : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
          )}
        >
          <span className="text-base">⚠</span>
          <b>{v.name}</b>
          <span className="font-semibold">{ERR[v.err!.code] ?? v.err!.code}</span>
          <span className="opacity-75">
            — {v.err!.reason}（{fmtT(v.err!.at)}）
          </span>
          <div className="flex-1" />
          {v.err!.latched ? (
            <>
              <Tag tone="red">解除の操作が必要</Tag>
              <Btn size="sm" variant="danger" op onClick={() => askClear(v.id)}>
                解除…
              </Btn>
            </>
          ) : (
            <Tag tone="amber">原因がなくなると自動で戻ります</Tag>
          )}
          <Btn size="sm" onClick={() => openVehicle(v.id)}>
            車両を表示
          </Btn>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------
// ポップオーバー
// ---------------------------------------------------------------
export function PopoverHost() {
  const s = useStore();
  const p = s.popover;

  // 外側をクリックしたら閉じる（開くボタン・地図は除く）
  useEffect(() => {
    const h = (e: PointerEvent) => {
      const t = e.target as Element;
      if (t.closest('#popover') || t.closest('[data-pop-trigger]')) return;
      closePop();
    };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, []);

  if (!p) return null;
  const style = p.right
    ? { right: window.innerWidth - p.x, top: p.y }
    : { left: Math.min(p.x + 10, window.innerWidth - 300), top: Math.min(p.y + 10, window.innerHeight - 280) };

  return (
    <div id="popover" style={style} className="fixed z-[350] w-72 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800 shadow-2xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      {p.kind === 'conn' && <ConnPop />}
      {p.kind === 'bell' && <BellPop />}
      {p.kind === 'user' && <UserPop />}
      {p.kind === 'veh' && p.id && <VehPop id={p.id} />}
      {p.kind === 'wp' && p.id && <WpPop name={p.id} />}
    </div>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return <span className={cx('inline-block h-2 w-2 rounded-full', ok ? 'bg-green-500' : 'bg-red-500')} />;
}

function ConnPop() {
  const s = useStore();
  return (
    <div className="space-y-2">
      <div className="font-bold">接続状態</div>
      <div className="flex items-center gap-2">
        <Dot ok={s.server} /> ブラウザ ⇔ サーバー<span className="ml-auto text-slate-500">{s.server ? '接続中' : '切断'}</span>
      </div>
      <div className="flex items-center gap-2">
        <Dot ok={s.mqtt} /> サーバー ⇔ MQTT<span className="ml-auto text-slate-500">{s.mqtt ? '接続中' : '切断'}</span>
      </div>
      <div className="border-t border-slate-200 pt-2 dark:border-slate-700">
        {s.vehicles.map((v) => (
          <div key={v.id} className="flex items-center gap-2 py-0.5">
            <Dot ok={v.online && s.mqtt} /> {v.name}
            <span className="ml-auto text-xs text-slate-500">{v.online && v.lastHb ? `最終受信 ${fmtT(v.lastHb)}` : 'データなし'}</span>
          </div>
        ))}
      </div>
      <button type="button" className="text-blue-600 hover:underline" onClick={() => { closePop(); nav('/settings/system'); }}>
        システム情報を見る →
      </button>
    </div>
  );
}

function BellPop() {
  const s = useStore();
  return (
    <div>
      <div className="mb-2 flex items-center">
        <b>通知</b>
        <div className="flex-1" />
        <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => { s.notes.forEach((n) => (n.read = true)); emit(); }}>
          すべて既読にする
        </button>
      </div>
      {!s.notes.length && <div className="py-4 text-center text-slate-400">通知はありません</div>}
      <div className="max-h-80 space-y-1 overflow-auto">
        {s.notes.slice(0, 12).map((n) => (
          <button
            type="button"
            key={n.id}
            onClick={() => {
              n.read = true;
              nav('/');
              openVehicle(n.vid);
            }}
            className={cx('block w-full rounded-md px-2 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800', !n.read && 'bg-red-50 dark:bg-red-950/50')}
          >
            <div className={cx(!n.read && 'font-bold')}>
              {!n.read && <span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />}
              {n.text}
            </div>
            <div className="text-xs text-slate-500">{fmtDT(n.at)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function UserPop() {
  const s = useStore();
  return (
    <div className="space-y-3">
      <div>
        <div className="font-bold">{s.user.name}</div>
        <div className="text-xs text-slate-500">権限: {s.user.role}</div>
      </div>
      <div className="flex gap-2">
        <Btn size="sm" disabled={s.demo} title={s.demo ? 'デモモード中は使えません' : undefined} onClick={() => openModal({ kind: 'password' })}>
          パスワード変更
        </Btn>
        <Btn size="sm" onClick={() => { nav('/'); logout(); }}>
          ログアウト
        </Btn>
      </div>
    </div>
  );
}

function VehPop({ id }: { id: string }) {
  useStore();
  const v = veh(id);
  if (!v) return null;
  const t = task(v.taskId);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <b className="text-base">{v.name}</b>
        <span className="text-xs text-slate-500">{v.id}</span>
        <div className="flex-1" />
        <VChip v={v} />
      </div>
      <div className="flex gap-3 text-xs text-slate-600 dark:text-slate-300">
        <Battery v={v} />
        <span>{fmtNum(v.speed, 1, ' m/s')}</span>
        <span>自己位置 {v.loc == null ? '—' : `${Math.round(v.loc * 100)}%`}</span>
      </div>
      <div className="text-xs">{t ? `📦 ${t.title}（進捗 ${fmtPct(t.progress)}）` : 'タスクなし'}</div>
      {v.err && <div className="rounded bg-red-50 p-1.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{ERR[v.err.code] ?? v.err.code}: {v.err.reason}</div>}
      <div className="flex gap-2 pt-1">
        <Btn size="sm" variant="pri" onClick={() => openVehicle(v.id)}>
          詳しく見る
        </Btn>
        <Btn size="sm" onClick={() => { closePop(); nav(`/vehicles/${v.id}`); }}>
          カメラ
        </Btn>
        <div className="flex-1" />
        <Btn size="sm" variant="danger" disabled={!v.online || v.status === 'ERROR'} onClick={() => estop(v.id)}>
          ■ 停止
        </Btn>
      </div>
    </div>
  );
}

function WpPop({ name }: { name: string }) {
  const s = useStore();
  const w = wpByName(name);
  if (!w) return null;
  const n = s.tasks.filter((t) => (t.start === name || t.target === name) && ['PENDING', 'ASSIGNED', 'IN_PROGRESS'].includes(t.status)).length;
  return (
    <div className="space-y-1.5">
      <div className="font-bold">
        {w.name} <span className="font-normal text-slate-500">{w.label}</span>
      </div>
      <div className="text-xs text-slate-500">
        x {w.x} / y {w.y} m{w.charger && ' ・ 充電器'}
      </div>
      <div className="text-xs">別名: {w.aliases.join('、') || '—'}</div>
      <div className="text-xs">この地点を使う未完了のタスク: {n}件</div>
    </div>
  );
}

// ---------------------------------------------------------------
// トースト
// ---------------------------------------------------------------
export function Toasts() {
  const s = useStore();
  const c = {
    info: 'bg-slate-800 text-white',
    ok: 'bg-green-700 text-white',
    warn: 'bg-amber-500 text-slate-900',
    error: 'bg-red-600 text-white',
  };
  return (
    <div className="fixed bottom-4 left-1/2 z-[400] flex w-[440px] -translate-x-1/2 flex-col items-center gap-2">
      {s.toasts.map((t) => (
        <div key={t.id} className={cx('toast-in rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg', c[t.type])}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}
