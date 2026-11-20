// 地図・地点：地図と地点（config/waypoints/<地図名>.yaml、無ければ waypoints.yaml）の確認。編集は将来
import { useState } from 'react';
import { WAYPOINTS } from '../store/data';
import { activeOwnWaypoints, MAP, MAP_IDS } from '../store/map';
import { pickMap, useStore } from '../store/store';
import { MapView } from '../components/MapView';
import { Btn, Card, inputCls, Kv, Tag } from '../components/ui';
import { cx } from '../components/uiUtils';

export function MapPage() {
  const s = useStore();
  const [sel, setSel] = useState<string | null>(null);
  return (
    <div className="grid h-full grid-cols-[1fr_380px] gap-3 p-3">
      <Card
        title={
          <>
            地図
            <select
              aria-label="表示する地図"
              className={cx(inputCls, 'w-64 font-normal')}
              value={MAP.id}
              onChange={(e) => {
                setSel(null);
                pickMap(e.target.value);
              }}
            >
              {MAP_IDS.map((id) => {
                const n = s.vehicles.filter((v) => v.mapId === id).length;
                return (
                  <option key={id} value={id}>
                    {id}
                    {n ? `（車両 ${n}台）` : ''}
                  </option>
                );
              })}
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
              ['大きさ', `${MAP.width.toFixed(1)}m × ${MAP.height.toFixed(1)}m`],
            ]}
          />
        </Card>
        <Card
          title={
            <>
              地点<span className="text-xs font-normal text-slate-500">{WAYPOINTS.length}件</span>
              {!activeOwnWaypoints() && (
                <span title="この地図用の地点ファイルが無いので、共通の waypoints.yaml を表示しています">
                  <Tag tone="amber">共通の地点</Tag>
                </span>
              )}
            </>
          }
          right={
            <Btn size="sm" admin disabled title="未対応">
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
        </Card>
      </div>
    </div>
  );
}
