// 地図・地点：地図と地点（waypoints.yaml）の確認。編集は将来
import { useState } from 'react';
import { WAYPOINTS } from '../store/data';
import { MAP } from '../store/map';
import { useStore } from '../store/store';
import { MapView } from '../components/MapView';
import { Btn, Card, Kv, Tag } from '../components/ui';
import { cx } from '../components/uiUtils';

export function MapPage() {
  const s = useStore();
  const [sel, setSel] = useState<string | null>(null);
  return (
    <div className="grid h-full grid-cols-[1fr_380px] gap-3 p-3">
      <Card
        title={
          <>
            地図 <span className="text-xs font-normal text-slate-500">{MAP.id}（ROS の agv_navigation/maps）</span>
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
              ['ファイル', `agv_navigation/maps/${MAP.id}.yaml`],
              ['大きさ', `${MAP.width.toFixed(1)}m × ${MAP.height.toFixed(1)}m（${MAP.cols} × ${MAP.rows} px）`],
              ['解像度', `${MAP.resolution} m/px`],
              ['原点', `(${MAP.originX.toFixed(1)}, ${MAP.originY.toFixed(1)})`],
            ]}
          />
          <div className="mt-2 text-xs text-slate-400">
            ※ ROS 側の地図と waypoints.yaml をそのまま表示しています（Web からは書き換えません）。地図を変えるときは frontend/src/store/map.ts の読み込み先を、PC1 の mission.yaml の map_id と合わせてください。
          </div>
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
