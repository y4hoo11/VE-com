// 車両詳細ページ：カメラを大きく映す。手動操縦（将来）もここに置く
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { closeDrawer, nav, openLog, S, useStore, veh } from '../mock/store';
import type { Vehicle } from '../mock/data';
import { VehiclePanel } from '../components/Drawer';
import { MapView } from '../components/MapView';
import { Btn, Card, fmtT, LvChip, Tag, VChip } from '../components/ui';

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
          <Card
            title={
              <>
                手動操縦 <Tag tone="amber">将来</Tag>
              </>
            }
            bodyClass="p-4"
          >
            <div className="flex items-center gap-6">
              <div className="grid grid-cols-3 gap-1.5 opacity-40">
                <div />
                <Key k="W" />
                <div />
                <Key k="A" />
                <Key k="S" />
                <Key k="D" />
              </div>
              <p className="m-0 text-sm text-slate-500">
                WASD での遠隔操縦は、通信仕様（docs/agv_protocol.md）に Web から操縦する命令がまだ無いので未実装です。
                速度の上限や「押している間だけ動く」方式など、安全面をチームで決めてから追加します。
              </p>
            </div>
          </Card>
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

function Key({ k }: { k: string }) {
  return <div className="flex h-11 w-11 items-center justify-center rounded-md border-2 border-slate-300 font-bold dark:border-slate-600">{k}</div>;
}

// 偽のカメラ映像（床の線・ArUco マーカーと検出枠）
function Camera({ v }: { v: Vehicle }) {
  if (!v.online) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-b-xl bg-slate-900 text-slate-400">
        📷 映像を受信できません（車両がオフライン）
      </div>
    );
  }
  const shift = ((v.x * 37 + v.y * 23) % 60) - 30;
  return (
    <div className="relative aspect-video overflow-hidden rounded-b-xl bg-slate-900">
      <svg viewBox="0 0 640 360" className="h-full w-full">
        <defs>
          <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#334155" />
            <stop offset="1" stopColor="#64748b" />
          </linearGradient>
        </defs>
        <rect width="640" height="170" fill="#1e293b" />
        <rect y="170" width="640" height="190" fill="url(#floor)" />
        {Array.from({ length: 11 }, (_, i) => i - 5).map((i) => (
          <line key={i} x1={320 + i * 18} y1={170} x2={320 + i * 150} y2={360} stroke="#94a3b8" strokeOpacity={0.35} />
        ))}
        {[185, 205, 235, 280, 345].map((y) => (
          <line key={y} x1={0} y1={y} x2={640} y2={y} stroke="#94a3b8" strokeOpacity={0.25} />
        ))}
        <rect x={40} y={60} width={130} height={150} fill="#475569" />
        <rect x={470} y={70} width={140} height={140} fill="#475569" />
        <g transform={`translate(${380 + shift} 120)`}>
          <rect width="56" height="56" fill="white" />
          <rect x="6" y="6" width="44" height="44" fill="black" />
          <rect x="14" y="14" width="10" height="10" fill="white" />
          <rect x="30" y="14" width="10" height="18" fill="white" />
          <rect x="14" y="32" width="18" height="8" fill="white" />
          <rect x="-6" y="-6" width="68" height="68" fill="none" stroke="#22c55e" strokeWidth="3" />
          <text x="-6" y="-12" fill="#22c55e" fontSize="13" fontFamily="monospace">
            ID 7 ・ 1.42 m
          </text>
        </g>
      </svg>
      <div className="absolute top-2 left-3 flex items-center gap-2 text-xs font-bold text-white">
        <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> LIVE ・ {v.name}
      </div>
      <div className="absolute top-2 right-3 font-mono text-xs text-white/80">{fmtT(Date.now())}</div>
      <div className="absolute bottom-2 left-3 font-mono text-xs text-white/60">{v.camera}</div>
    </div>
  );
}
