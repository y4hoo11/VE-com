// 地図（SVG）。車両・経路・地点を描き、地図の操作モード（移動先・現在地の指定）も受け持つ
// ズーム：ホイール（カーソルの位置を中心に）か右下のボタン。拡大中は何もない所をドラッグして動かす
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { COL, PAUSED_COL, WAYPOINTS, wpByName, type Pt } from '../store/data';
import { MAP, MAP_IMAGE } from '../store/map';
import { askGoto, cancelMapMode, closePop, mapModeClick, nearestWp, setMapCursor, togglePop, useStore, veh } from '../store/store';
import { cx } from './uiUtils';

// 地図の座標 [m]（Nav2 の map 座標。左下が origin）→ SVG の座標（1m = 100、上が 0）
const W = MAP.width * 100;
const H = MAP.height * 100;
const X = (x: number) => (x - MAP.originX) * 100;
const Y = (y: number) => (MAP.originY + MAP.height - y) * 100;
// 方眼（1m ごと）を引く位置
const GRID_X = Array.from({ length: Math.floor(MAP.width) + 1 }, (_, i) => Math.ceil(MAP.originX) + i).filter((k) => k > MAP.originX && k < MAP.originX + MAP.width);
const GRID_Y = Array.from({ length: Math.floor(MAP.height) + 1 }, (_, i) => Math.ceil(MAP.originY) + i).filter((k) => k > MAP.originY && k < MAP.originY + MAP.height);

// 表示範囲（SVG の viewBox）。FULL が全体表示
type View = { x: number; y: number; w: number; h: number };
const FULL: View = { x: -40, y: -40, w: W + 80, h: H + 80 };
const MAX_ZOOM = 8;
const STEP = 1.25;

// 中心 (cx, cy) を固定して k 倍に拡大（k < 1 で縮小）し、地図の外に出すぎないようにする
function zoomView(v: View, k: number, cx: number, cy: number): View {
  const w = Math.min(FULL.w, Math.max(FULL.w / MAX_ZOOM, v.w / k));
  const h = (w / FULL.w) * FULL.h;
  const r = w / v.w;
  return clampView({ x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r, w, h });
}
function clampView(v: View): View {
  return {
    ...v,
    x: Math.min(FULL.x + FULL.w - v.w, Math.max(FULL.x, v.x)),
    y: Math.min(FULL.y + FULL.h - v.h, Math.max(FULL.y, v.y)),
  };
}

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
  const [view, setView] = useState<View>(FULL);
  const pan = useRef<{ px: number; py: number; v: View; scale: number } | null>(null);
  const zoomed = view.w < FULL.w - 0.5;

  // 画面上の点 → SVG の座標（viewBox の単位）
  const toSvg = (clientX: number, clientY: number) => {
    const svg = ref.current!;
    const p = svg.createSVGPoint();
    p.x = clientX;
    p.y = clientY;
    return p.matrixTransform(svg.getScreenCTM()!.inverse());
  };

  // ホイールでズーム（ページがスクロールしないよう passive: false で登録する）
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = toSvg(e.clientX, e.clientY);
      const k = e.deltaY < 0 ? STEP : 1 / STEP;
      setView((v) => zoomView(v, k, c.x, c.y));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBtn = (k: number) => setView((v) => zoomView(v, k, v.x + v.w / 2, v.y + v.h / 2));
  const selected = s.drawer?.type === 'vehicle' ? s.drawer.id : focusId;

  const toWorld = (e: PointerEvent): Pt => {
    const svg = ref.current!;
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: MAP.originX + q.x / 100, y: MAP.originY + MAP.height - q.y / 100 };
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
    // 何もない所を押したら、ドラッグで地図を動かす（拡大しているときだけ）
    if (zoomed) {
      pan.current = { px: e.clientX, py: e.clientY, v: view, scale: ref.current!.getScreenCTM()!.a };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }
  };
  const onMove = (e: PointerEvent) => {
    const p = pan.current;
    if (p) {
      const dx = (e.clientX - p.px) / p.scale;
      const dy = (e.clientY - p.py) / p.scale;
      setView(clampView({ ...p.v, x: p.v.x - dx, y: p.v.y - dy }));
      return;
    }
    if (mm) setMapCursor(toWorld(e));
  };
  const onUp = () => {
    pan.current = null;
  };

  const vehicles = [...s.vehicles].sort((a) => (a.id === selected ? 1 : -1));
  const snap = mm?.type === 'goto' && mm.cursor ? nearestWp(mm.cursor) : undefined;

  return (
    <div className="absolute inset-0">
      <svg
        ref={ref}
        data-pop-trigger
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        className={cx('h-full w-full touch-none select-none', mm ? 'cursor-crosshair' : zoomed && 'cursor-grab')}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <defs>
          <marker id={`arr-${mapKey}`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#f59e0b" />
          </marker>
        </defs>

        {/* 床・方眼 */}
        <rect x={0} y={0} width={W} height={H} className="fill-slate-50 dark:fill-slate-950" />
        {/* ROS の地図（壁・棚 = 濃い色、未知 = 薄い色） */}
        {MAP_IMAGE && <image href={MAP_IMAGE} x={0} y={0} width={W} height={H} preserveAspectRatio="none" style={{ imageRendering: 'pixelated' }} className="dark:invert-[0.15]" />}
        {s.view.grid && (
          <g className="stroke-slate-200 dark:stroke-slate-800" strokeWidth={1.5}>
            {GRID_X.map((k) => (
              <line key={'v' + k} x1={X(k)} y1={0} x2={X(k)} y2={H} />
            ))}
            {GRID_Y.map((k) => (
              <line key={'h' + k} x1={0} y1={Y(k)} x2={W} y2={Y(k)} />
            ))}
          </g>
        )}
        <rect x={0} y={0} width={W} height={H} fill="none" className="stroke-slate-400 dark:stroke-slate-600" strokeWidth={4} />

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
      <div className="absolute right-2 bottom-2 z-10 flex flex-col overflow-hidden rounded-md border border-slate-300 bg-white text-sm shadow dark:border-slate-600 dark:bg-slate-800">
        <button type="button" title="拡大" className="h-8 w-8 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-700" disabled={view.w <= FULL.w / MAX_ZOOM + 0.5} onClick={() => zoomBtn(STEP)}>
          ＋
        </button>
        <button type="button" title="縮小" className="h-8 w-8 border-t border-slate-200 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-700" disabled={!zoomed} onClick={() => zoomBtn(1 / STEP)}>
          －
        </button>
        <button type="button" title="全体を表示" className="h-8 w-8 border-t border-slate-200 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-700" disabled={!zoomed} onClick={() => setView(FULL)}>
          ⤢
        </button>
      </div>
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
