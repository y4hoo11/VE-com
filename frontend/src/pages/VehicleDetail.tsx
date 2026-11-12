// 車両詳細ページ：カメラを大きく映す。手動操縦（WASD）もここに置く
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { canOperate, closeDrawer, manualDrive, nav, openLog, S, toast, useStore, veh } from '../store/store';
import type { Vehicle } from '../store/data';
import { VehiclePanel } from '../components/Drawer';
import { MapView } from '../components/MapView';
import { Btn, Card, LvChip, Tag, VChip } from '../components/ui';
import { cx, fmtT } from '../components/uiUtils';

export function VehicleDetail() {
  const { id } = useParams();
  const s = useStore();
  const v = veh(id);
  // 車両のドロワーは詳細ページと中身が重なるので閉じる
  useEffect(() => {
    if (S.drawer?.type === 'vehicle') closeDrawer();
  }, [id]);
  if (!v) {
    return (
      <div className="p-6">
        <p>車両「{id}」が見つかりません</p>
        <Btn onClick={() => nav('/')}>← 運行モニターへ</Btn>
      </div>
    );
  }
  const logs = s.logs.filter((l) => l.vid === v.id).slice(0, 12);

  return (
    <div className="h-full overflow-auto p-3">
      <div className="mb-3 flex items-center gap-3">
        <Btn size="sm" onClick={() => nav('/')}>
          ← 運行モニター
        </Btn>
        <h2 className="m-0 text-xl font-bold">
          {v.name} <span className="text-sm font-normal text-slate-500">{v.id}</span>
        </h2>
        <VChip v={v} />
        <span className="ml-auto text-xs text-slate-500">SPACE キーでも緊急停止できます</span>
      </div>

      <div className="grid grid-cols-[1fr_420px] gap-3">
        <div className="space-y-3">
          <Card
            title={
              <>
                カメラ映像<span className="text-xs font-normal text-slate-500">マーカー解析つき（PC1 が配信する MJPEG）</span>
              </>
            }
          >
            <Camera v={v} />
          </Card>
          <ManualDrive key={v.id} v={v} />
          <Card title="この車両のログ">
            <table className="w-full text-sm">
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800" onClick={() => openLog(l.id)}>
                    <td className="w-20 px-4 py-1.5 text-slate-500">{fmtT(l.at)}</td>
                    <td className="w-16 py-1.5">
                      <LvChip l={l.level} />
                    </td>
                    <td className="py-1.5">{l.message}</td>
                  </tr>
                ))}
                {!logs.length && (
                  <tr>
                    <td className="px-4 py-3 text-slate-400">ログはありません</td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>

        <div className="space-y-3">
          <Card title="状態と操作" bodyClass="p-4 space-y-4">
            <VehiclePanel v={v} />
          </Card>
          <Card title="位置" bodyClass="relative h-64">
            <MapView mapKey="detail" focusId={v.id} />
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// 手動操縦（WASD）。「操縦を始める」を押してから、キーを押している間だけ動く。
// 離す・別のウィンドウに移る・ページを離れると止まる。SPACE は緊急停止
// ---------------------------------------------------------------
type DriveKey = 'W' | 'A' | 'S' | 'D';
const KEY_OF: Record<string, DriveKey> = { KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D' };
const SPEEDS = [
  { label: '低速', linear: 0.1, angular: 0.5 },
  { label: '標準', linear: 0.2, angular: 0.8 },
  { label: '最大', linear: 0.3, angular: 1.0 }, // サーバーの上限と同じ
];
const SEND_MS = 200;

function whyCannotDrive(v: Vehicle) {
  if (!v.online) return 'オフラインの車両は操縦できません';
  if (v.status === 'ERROR') return '異常中は操縦できません（先に緊急状態を解除してください）';
  if (v.taskId) return 'タスクを実行中は操縦できません（先にタスクを中止してください）';
  if (v.mode === 'GOTO') return '地点へ移動中は操縦できません';
  return null;
}

function ManualDrive({ v }: { v: Vehicle }) {
  useStore();
  const [armed, setArmed] = useState(false);
  const [keys, setKeys] = useState<Set<DriveKey>>(new Set());
  const [speed, setSpeed] = useState(1);
  const reason = whyCannotDrive(v);
  const active = armed && !reason; // 車両が止められない状態になったら、操縦も自動で終わる

  // 送信ループから最新の値を読むための入れ物
  const keysRef = useRef(keys);
  const speedRef = useRef(speed);
  const movingRef = useRef(false);
  useEffect(() => {
    keysRef.current = keys;
    speedRef.current = speed;
  });

  useEffect(() => {
    if (!active) return;
    const release = () => setKeys(new Set());
    const down = (e: KeyboardEvent) => {
      const k = KEY_OF[e.code];
      if (!k || S.modal || (e.target as Element).closest('input, textarea, select')) return;
      e.preventDefault();
      setKeys((prev) => (prev.has(k) ? prev : new Set(prev).add(k)));
    };
    const up = (e: KeyboardEvent) => {
      const k = KEY_OF[e.code];
      if (!k) return;
      setKeys((prev) => {
        const next = new Set(prev);
        next.delete(k);
        return next;
      });
    };
    const hidden = () => document.hidden && release();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', hidden);

    // 押している間は 0.2 秒ごとに送る。離したら 1 回だけ「止まれ」を送る
    const stop = () => {
      if (!movingRef.current) return;
      movingRef.current = false;
      void manualDrive(v.id, 0, 0);
    };
    const timer = setInterval(() => {
      const k = keysRef.current;
      const sp = SPEEDS[speedRef.current];
      const linear = ((k.has('W') ? 1 : 0) - (k.has('S') ? 1 : 0)) * sp.linear;
      const angular = ((k.has('A') ? 1 : 0) - (k.has('D') ? 1 : 0)) * sp.angular;
      if (linear === 0 && angular === 0) return stop();
      movingRef.current = true;
      manualDrive(v.id, linear, angular).then((r) => {
        if (r.ok || !movingRef.current) return;
        movingRef.current = false;
        setArmed(false);
        setKeys(new Set());
        toast(`手動操縦を止めました: ${r.error}`, 'error');
      });
    }, SEND_MS);

    return () => {
      clearInterval(timer);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', hidden);
      stop(); // 操縦をやめた・ページを離れたときも止める
    };
  }, [active, v.id]);

  const toggle = () => {
    setKeys(new Set());
    setArmed((a) => !a);
    // ボタンにフォーカスが残ると SPACE の緊急停止が効かないので外す
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const shown = active ? keys : new Set<DriveKey>();
  return (
    <Card
      title={
        <>
          手動操縦 {S.demo ? <Tag tone="blue">デモ</Tag> : <Tag tone="amber">ROS 側の対応待ち</Tag>}
        </>
      }
      right={
        canOperate() && (
          <Btn size="sm" variant={active ? 'danger' : 'pri'} disabled={!!reason && !armed} title={reason ?? undefined} onClick={toggle}>
            {active ? '■ 操縦をやめる' : '▶ 操縦を始める'}
          </Btn>
        )
      }
      bodyClass="p-4"
    >
      <div className="flex items-center gap-6">
        <div className={cx('grid grid-cols-3 gap-1.5', !active && 'opacity-40')}>
          <div />
          <Key k="W" on={shown.has('W')} />
          <div />
          <Key k="A" on={shown.has('A')} />
          <Key k="S" on={shown.has('S')} />
          <Key k="D" on={shown.has('D')} />
        </div>
        <div className="space-y-2 text-sm">
          {!canOperate() ? (
            <p className="m-0 text-slate-500">閲覧のみの権限では操縦できません。</p>
          ) : reason ? (
            <p className="m-0 text-slate-500">{reason}</p>
          ) : active ? (
            <p className="m-0">
              <b>W</b> 前進 ・ <b>S</b> 後退 ・ <b>A</b> 左回り ・ <b>D</b> 右回り。キーを<b>押している間だけ</b>動きます。
              <span className="text-red-600"> SPACE で緊急停止。</span>
            </p>
          ) : (
            <p className="m-0 text-slate-500">「操縦を始める」を押すと、WASD キーで動かせます。</p>
          )}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">速さ</span>
            {SPEEDS.map((sp, i) => (
              <button
                key={sp.label}
                type="button"
                onClick={(e) => {
                  setSpeed(i);
                  e.currentTarget.blur();
                }}
                className={cx('rounded border px-2 py-0.5 text-xs', speed === i ? 'border-blue-500 bg-blue-50 font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300' : 'border-slate-300 dark:border-slate-600')}
              >
                {sp.label}（{sp.linear} m/s）
              </button>
            ))}
          </div>
          {!S.demo && <p className="m-0 text-xs text-slate-400">命令（MANUAL_DRIVE）は送られますが、ROS 側が受け取る処理を作るまで実機は動きません。</p>}
        </div>
      </div>
    </Card>
  );
}

function Key({ k, on }: { k: string; on?: boolean }) {
  return (
    <div className={cx('flex h-11 w-11 items-center justify-center rounded-md border-2 font-bold', on ? 'border-blue-500 bg-blue-500 text-white' : 'border-slate-300 dark:border-slate-600')}>
      {k}
    </div>
  );
}

// カメラ映像（PC1 の marker_localizer が配信する MJPEG）。URL を保存する仕組みは未対応
function Camera({ v }: { v: Vehicle }) {
  const msg = !v.camera
    ? '📷 カメラ映像のURLが登録されていません（URL を保存する仕組みは未対応）'
    : !v.online
      ? '📷 映像を受信できません（車両がオフライン）'
      : null;
  if (msg) {
    return <div className="flex aspect-video items-center justify-center rounded-b-xl bg-slate-900 px-6 text-center text-slate-400">{msg}</div>;
  }
  return (
    <div className="relative aspect-video overflow-hidden rounded-b-xl bg-slate-900">
      <img src={v.camera} alt={`${v.name} のカメラ映像`} className="h-full w-full object-contain" />
      <div className="absolute top-2 left-3 flex items-center gap-2 text-xs font-bold text-white">
        <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> LIVE ・ {v.name}
      </div>
      <div className="absolute bottom-2 left-3 font-mono text-xs text-white/60">{v.camera}</div>
    </div>
  );
}
