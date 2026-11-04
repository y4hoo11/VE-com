// 車両詳細ページ：カメラを大きく映す。手動操縦（将来）もここに置く
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { closeDrawer, nav, openLog, S, useStore, veh } from '../store/store';
import type { Vehicle } from '../store/data';
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
