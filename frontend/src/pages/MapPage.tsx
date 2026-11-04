// 地図・地点：地図と地点（waypoints.yaml）の確認。編集は将来
import { useState } from 'react';
import { WAYPOINTS } from '../store/data';
import { toast, useStore } from '../store/store';
import { MapView } from '../components/MapView';
import { Btn, Card, cx, inputCls, Kv, Tag } from '../components/ui';

export function MapPage() {
  const s = useStore();
  const [sel, setSel] = useState<string | null>(null);
  return (
    <div className="grid h-full grid-cols-[1fr_380px] gap-3 p-3">
      <Card
        title={
          <>
            地図
            <select className={cx(inputCls, 'w-56 font-normal')} defaultValue="warehouse_map" onChange={() => toast('地図の切り替えは未対応です（PC1 側の地図と合わせる仕組みが必要）', 'warn')}>
              <option value="warehouse_map">warehouse_map（使用中）</option>
              <option value="demo_map">demo_map</option>
            </select>
          </>
        }
        bodyClass="relative"
      >
        <MapView mapKey="wp" wpSel={sel} onWpClick={(n) => setSel(sel === n ? null : n)} />
      </Card>
      <div className="flex min-h-0 flex-col gap-3">
        <Card title="地図の情報" bodyClass="p-4">
          <Kv
            rows={[
              ['ファイル', 'map/warehouse_map.yaml'],
              ['大きさ', '16m × 10m（320 × 200 px）'],
              ['解像度', '0.05 m/px'],
              ['原点', '(-5.0, -5.0)'],
            ]}
          />
          <div className="mt-2 text-xs text-slate-400">※ いまは簡略図を表示しています。ROS 側と地図を合わせたら、PGM 画像を描く形に切り替えます。</div>
        </Card>
        <Card
          title={
            <>
              地点<span className="text-xs font-normal text-slate-500">waypoints.yaml ・ {WAYPOINTS.length}件</span>
            </>
          }
          right={
            <Btn size="sm" admin disabled title="将来対応">
              ＋ 追加
            </Btn>
          }
          bodyClass="overflow-auto"
        >
          {WAYPOINTS.map((w) => {
            const n = s.tasks.filter((t) => (t.start === w.name || t.target === w.name) && ['PENDING', 'ASSIGNED', 'IN_PROGRESS'].includes(t.status)).length;
            return (
              <button
                type="button"
                key={w.name}
                onClick={() => setSel(sel === w.name ? null : w.name)}
                className={cx('block w-full border-b border-slate-100 px-4 py-2.5 text-left hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800', sel === w.name && 'bg-blue-50 dark:bg-blue-950')}
              >
                <div className="flex items-center gap-2">
                  <b>{w.name}</b>
                  <span className="text-sm text-slate-500">{w.label}</span>
                  {w.charger && <Tag tone="blue">充電器</Tag>}
                  <span className="ml-auto text-xs text-slate-500">
                    ({w.x}, {w.y})
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-slate-400">
                  別名: {w.aliases.join('、') || '—'} ・ 未完了のタスク {n}件
                </div>
              </button>
            );
          })}
          <div className="p-4 text-xs text-slate-400">地点の追加・編集は将来対応です。PC1 の waypoints.yaml に反映する方法を決めてから作ります。</div>
        </Card>
      </div>
    </div>
  );
}
