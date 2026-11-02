// 地図（SVG）。車両・経路・地点を描き、地図の操作モード（移動先・現在地の指定）も受け持つ
import { useRef, type PointerEvent } from 'react';
import { COL, MAP_H, MAP_W, OFFICE, PAUSED_COL, SHELVES, WAYPOINTS, ZONES, wpByName, type Pt } from '../mock/data';
import { askGoto, cancelMapMode, closePop, mapModeClick, nearestWp, setMapCursor, togglePop, useStore, veh } from '../mock/store';
import { cx } from './ui';

const X = (x: number) => x * 100;
const Y = (y: number) => (MAP_H - y) * 100;

type Props = {
  mapKey: 'main' | 'detail' | 'wp';
  focusId?: string;
  wpSel?: string | null;
  onWpClick?: (name: string) => void;
};

export function MapView({ mapKey, focusId, wpSel, onWpClick }: Props) {
  const s = useStore();
  const ref = useRef<SVGSVGElement>(null);
  const mm = mapKey === 'wp' ? null : s.mapMode;
  const selected = s.drawer?.type === 'vehicle' ? s.drawer.id : focusId;

  const toWorld = (e: PointerEvent): Pt => {
    const svg = ref.current!;
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: q.x / 100, y: MAP_H - q.y / 100 };
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const w = toWorld(e);
    if (mm) return mapModeClick(w);
    const t = e.target as Element;
    const vid = t.closest('[data-vid]')?.getAttribute('data-vid');
    if (vid) return togglePop({ kind: 'veh', id: vid, x: e.clientX, y: e.clientY });
    const wn = t.closest('[data-wp]')?.getAttribute('data-wp');
    if (wn) return onWpClick ? onWpClick(wn) : togglePop({ kind: 'wp', id: wn, x: e.clientX, y: e.clientY });
    closePop();
  };
  const onMove = (e: PointerEvent) => {
    if (mm) setMapCursor(toWorld(e));
  };

  const vehicles = [...s.vehicles].sort((a) => (a.id === selected ? 1 : -1));
  const snap = mm?.type === 'goto' && mm.cursor ? nearestWp(mm.cursor) : undefined;

  return (
    <div className="absolute inset-0">
      <svg
        ref={ref}
        data-pop-trigger
        viewBox={`-40 -40 ${MAP_W * 100 + 80} ${MAP_H * 100 + 80}`}
        preserveAspectRatio="xMidYMid meet"
        className={cx('h-full w-full select-none', mm && 'cursor-crosshair')}
        onPointerDown={onDown}
        onPointerMove={onMove}
      >
        <defs>
          <marker id={`arr-${mapKey}`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#f59e0b" />
          </marker>
        </defs>

        {/* 床・方眼 */}
        <rect x={0} y={0} width={MAP_W * 100} height={MAP_H * 100} className="fill-slate-50 dark:fill-slate-950" />
        {s.view.grid && (
          <g className="stroke-slate-200 dark:stroke-slate-800" strokeWidth={1.5}>
            {Array.from({ length: MAP_W - 1 }, (_, i) => (
              <line key={'v' + i} x1={(i + 1) * 100} y1={0} x2={(i + 1) * 100} y2={MAP_H * 100} />
            ))}
            {Array.from({ length: MAP_H - 1 }, (_, i) => (
              <line key={'h' + i} x1={0} y1={(i + 1) * 100} x2={MAP_W * 100} y2={(i + 1) * 100} />
            ))}
          </g>
        )}

        {/* 区画・棚・事務所・外壁 */}
        {ZONES.map((z) => (
          <g key={z.label}>
            <rect x={X(z.x)} y={Y(z.y + z.h)} width={z.w * 100} height={z.h * 100} rx={10} className="fill-blue-50 stroke-blue-200 dark:fill-blue-950/40 dark:stroke-blue-900" strokeWidth={3} strokeDasharray="10 8" />
            <text x={X(z.x) + 14} y={Y(z.y + z.h) + 34} className="fill-blue-300 dark:fill-blue-800" fontSize={26} fontWeight={700}>
              {z.label}
            </text>
          </g>
        ))}
        {SHELVES.map(([x, y, w, h], i) => (
          <rect key={i} x={X(x)} y={Y(y + h)} width={w * 100} height={h * 100} rx={4} className="fill-slate-300 stroke-slate-400 dark:fill-slate-700 dark:stroke-slate-600" strokeWidth={3} />
        ))}
        <rect x={X(OFFICE[0])} y={Y(OFFICE[1] + OFFICE[3])} width={OFFICE[2] * 100} height={OFFICE[3] * 100} className="fill-slate-200 stroke-slate-500 dark:fill-slate-800" strokeWidth={6} />
        <text x={X(OFFICE[0] + OFFICE[2] / 2)} y={Y(OFFICE[1] + OFFICE[3] / 2) + 10} textAnchor="middle" fontSize={28} className="fill-slate-500">
          事務所（立入不可）
        </text>
        <rect x={0} y={0} width={MAP_W * 100} height={MAP_H * 100} fill="none" className="stroke-slate-700 dark:stroke-slate-400" strokeWidth={14} />

        {/* 地点 */}
        {WAYPOINTS.map((w) => {
          const sel = wpSel === w.name || snap?.name === w.name;
          return (
            <g key={w.name} data-wp={w.name} className={cx(!mm && 'cursor-pointer')}>
              {sel && <circle cx={X(w.x)} cy={Y(w.y)} r={36} className="fill-blue-500/15 stroke-blue-500" strokeWidth={4} />}
              <circle cx={X(w.x)} cy={Y(w.y)} r={15} className={cx('stroke-slate-500 dark:stroke-slate-400', w.charger ? 'fill-cyan-100' : 'fill-white dark:fill-slate-900')} strokeWidth={4} />
              {(s.view.labels || mapKey === 'wp') && (
                <text x={X(w.x)} y={Y(w.y) + 46} textAnchor="middle" fontSize={24} fontWeight={600} className="fill-slate-500 dark:fill-slate-400">
                  {w.name}
                </text>
              )}
            </g>
          );
        })}

        {/* 予定の経路 */}
        {s.view.path &&
          mapKey !== 'wp' &&
          s.vehicles
            .filter((v) => v.online && v.route.length > 1 && (!focusId || v.id === focusId))
            .map((v) => {
              const end = v.route[v.route.length - 1];
              return (
                <g key={'p' + v.id} opacity={v.paused || v.status === 'ERROR' ? 0.45 : 1}>
                  <polyline points={v.route.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')} fill="none" stroke={COL.RUNNING} strokeOpacity={0.55} strokeWidth={7} strokeDasharray="16 12" strokeLinecap="round" />
                  <circle cx={X(end.x)} cy={Y(end.y)} r={22} fill="none" stroke={COL.RUNNING} strokeWidth={5} />
                  <circle cx={X(end.x)} cy={Y(end.y)} r={8} fill={COL.RUNNING} />
                </g>
              );
            })}

        {/* 車両 */}
        {vehicles.map((v) => {
          const col = v.paused && v.status === 'RUNNING' ? PAUSED_COL : COL[v.status];
          const dim = (focusId && v.id !== focusId) || mapKey === 'wp';
          const deg = (-v.theta * 180) / Math.PI;
          return (
            <g key={v.id} data-vid={v.id} transform={`translate(${X(v.x)} ${Y(v.y)})`} opacity={dim ? 0.35 : 1} className={cx(!mm && 'cursor-pointer')}>
              {v.status === 'ERROR' && <circle r={30} fill="none" stroke="#dc2626" strokeWidth={6} className="pulse-ring" />}
              {v.id === selected && <circle r={44} fill="none" stroke="#2563eb" strokeWidth={5} strokeDasharray="8 6" />}
              <g transform={`rotate(${deg})`}>
                <circle r={38} fill="transparent" />
                <polygon points="34,0 -22,-22 -12,0 -22,22" fill={col} stroke="white" strokeWidth={5} strokeLinejoin="round" />
              </g>
              <text y={-50} textAnchor="middle" fontSize={28} fontWeight={800} fill={col} stroke="white" strokeWidth={6} paintOrder="stroke">
                {v.name}
                {v.paused && v.status === 'RUNNING' ? ' ⏸' : ''}
              </text>
            </g>
          );
        })}

        {/* 地図の操作モード */}
        {mm?.cursor && mm.type === 'goto' && !snap && (
          <g pointerEvents="none">
            <circle cx={X(mm.cursor.x)} cy={Y(mm.cursor.y)} r={20} fill="none" stroke="#f59e0b" strokeWidth={5} />
            <circle cx={X(mm.cursor.x)} cy={Y(mm.cursor.y)} r={5} fill="#f59e0b" />
          </g>
        )}
        {mm?.type === 'pose' && mm.p && (
          <g pointerEvents="none">
            <circle cx={X(mm.p.x)} cy={Y(mm.p.y)} r={22} fill="#f59e0b33" stroke="#f59e0b" strokeWidth={5} />
            {mm.cursor && <line x1={X(mm.p.x)} y1={Y(mm.p.y)} x2={X(mm.cursor.x)} y2={Y(mm.cursor.y)} stroke="#f59e0b" strokeWidth={7} markerEnd={`url(#arr-${mapKey})`} />}
          </g>
        )}
      </svg>
      {mm && <MapModeBar />}
    </div>
  );
}

function MapModeBar() {
  const s = useStore();
  const mm = s.mapMode!;
  const v = veh(mm.vid);
  if (!v) return null;
  return (
    <div className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-slate-900 px-4 py-2.5 text-sm text-white shadow-xl">
      <span className="rounded bg-amber-500 px-1.5 py-0.5 text-xs font-bold text-slate-900">{mm.type === 'goto' ? '移動先の指定' : '現在地の設定'}</span>
      {mm.type === 'goto' ? (
        <>
          <span>
            <b>{v.name}</b> の移動先を地図でクリック
            <span className="ml-1 text-slate-400">（地点の近くは自動で地点に合わせます）</span>
          </span>
          <span className="text-slate-400">または</span>
          <select
            className="rounded bg-slate-700 px-2 py-1 text-white"
            value=""
            onChange={(e) => {
              const w = wpByName(e.target.value);
              if (w) askGoto(v.id, w);
            }}
          >
            <option value="">一覧から選ぶ…</option>
            {WAYPOINTS.map((w) => (
              <option key={w.name} value={w.name}>
                {w.name}（{w.label}）
              </option>
            ))}
          </select>
        </>
      ) : (
        <span>
          <b>{v.name}</b> {mm.p ? '② 車両が向いている方向をクリック' : '① 車両が今いる場所をクリック'}
        </span>
      )}
      <button type="button" className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-700" onClick={cancelMapMode}>
        キャンセル（Esc）
      </button>
    </div>
  );
}
