// 地図と地点。ROS 側（edge_ai/ros2_ws/src/agv_navigation）の地図・waypoints.yaml を、ビルド時にそのまま読み込む。
// ROS 側のファイルは読むだけ（書き換えない）。座標はすべて Nav2 の map 座標 [m]（telemetry の x, y と同じ）。
// 地図を変えるときは、下の import の demo_map を変える（PC1 の mission.yaml の map_id と合わせる）。
import { parse } from 'yaml';
import mapYamlText from '../../../edge_ai/ros2_ws/src/agv_navigation/maps/demo_map.yaml?raw';
import mapImageInline from '../../../edge_ai/ros2_ws/src/agv_navigation/maps/demo_map.pgm?inline';
import waypointsText from '../../../edge_ai/ros2_ws/src/agv_navigation/config/waypoints.yaml?raw';
import type { Pt, Waypoint } from './data';

export const MAP_ID = 'demo_map';

// ---------------------------------------------------------------
// 地図の設定（map.yaml）と画像（PGM）
// ---------------------------------------------------------------
type MapYaml = { resolution?: number; origin?: number[]; negate?: number; occupied_thresh?: number; free_thresh?: number };

// PGM（P5 = バイナリ）を読む。ヘッダーは「P5 幅 高さ 最大値」で、# から行末はコメント
function readPgm(bytes: Uint8Array) {
  let pos = 0;
  const token = () => {
    for (;;) {
      while (pos < bytes.length && /\s/.test(String.fromCharCode(bytes[pos]))) pos++;
      if (bytes[pos] !== 0x23) break; // '#'
      while (pos < bytes.length && bytes[pos] !== 0x0a) pos++;
    }
    let s = '';
    while (pos < bytes.length && !/\s/.test(String.fromCharCode(bytes[pos]))) s += String.fromCharCode(bytes[pos++]);
    return s;
  };
  const magic = token();
  const width = Number(token());
  const height = Number(token());
  const maxVal = Number(token());
  pos++; // ヘッダーの後の空白1つ
  if (magic !== 'P5' || !width || !height || maxVal > 255) throw new Error(`この地図画像は読めません（${magic} ${width}x${height} max=${maxVal}）`);
  return { width, height, maxVal, pixels: bytes.subarray(pos, pos + width * height) };
}

function decodeInline(dataUrl: string) {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const cfg = parse(mapYamlText) as MapYaml;
const pgm = readPgm(decodeInline(mapImageInline));

// 各マスの状態（行 0 が画像の上 = 地図の北）。Nav2 の trinary と同じ判定
export const CELL_FREE = 0;
export const CELL_OCCUPIED = 1;
export const CELL_UNKNOWN = 2;
const occThresh = cfg.occupied_thresh ?? 0.65;
const freeThresh = cfg.free_thresh ?? 0.25;
const cells = new Uint8Array(pgm.width * pgm.height);
pgm.pixels.forEach((v, i) => {
  const occ = cfg.negate ? v / pgm.maxVal : (pgm.maxVal - v) / pgm.maxVal;
  cells[i] = occ > occThresh ? CELL_OCCUPIED : occ < freeThresh ? CELL_FREE : CELL_UNKNOWN;
});

export const MAP = {
  id: MAP_ID,
  resolution: cfg.resolution ?? 0.05, // 1マスの大きさ [m]
  originX: cfg.origin?.[0] ?? 0, // 地図の左下の座標 [m]
  originY: cfg.origin?.[1] ?? 0,
  cols: pgm.width,
  rows: pgm.height,
  width: pgm.width * (cfg.resolution ?? 0.05), // [m]
  height: pgm.height * (cfg.resolution ?? 0.05),
  cells,
};

// 地図の画像（壁 = 濃い色、未知 = 薄い色、通れる所 = 透明。背景色は画面側で塗る）
function renderImage() {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = MAP.cols;
  canvas.height = MAP.rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(MAP.cols, MAP.rows);
  cells.forEach((c, i) => {
    const [r, g, b, a] = c === CELL_OCCUPIED ? [51, 65, 85, 255] : c === CELL_UNKNOWN ? [148, 163, 184, 90] : [0, 0, 0, 0];
    img.data.set([r, g, b, a], i * 4);
  });
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}
export const MAP_IMAGE = renderImage();

// 座標 [m] → マス（範囲外は null）
export function toCell(p: Pt) {
  const col = Math.floor((p.x - MAP.originX) / MAP.resolution);
  const row = MAP.rows - 1 - Math.floor((p.y - MAP.originY) / MAP.resolution);
  return col < 0 || row < 0 || col >= MAP.cols || row >= MAP.rows ? null : { col, row };
}
const cellCenter = (col: number, row: number): Pt => ({
  x: MAP.originX + (col + 0.5) * MAP.resolution,
  y: MAP.originY + (MAP.rows - 1 - row + 0.5) * MAP.resolution,
});

// ---------------------------------------------------------------
// 走れるか・経路（デモと、地図をクリックしたときの確認に使う。本物の経路は Nav2 が計画する）
// ---------------------------------------------------------------
export const ROBOT_RADIUS = 0.2; // [m] 壁からこれだけ離れていれば走れるとみなす

// 壁から ROBOT_RADIUS 以内のマスを「走れない」にした地図（起動時に1回だけ作る）
const blocked = (() => {
  const r = Math.ceil(ROBOT_RADIUS / MAP.resolution);
  const out = new Uint8Array(cells.length);
  for (let row = 0; row < MAP.rows; row++) {
    for (let col = 0; col < MAP.cols; col++) {
      if (cells[row * MAP.cols + col] === CELL_FREE) continue;
      for (let dr = -r; dr <= r; dr++) {
        for (let dc = -r; dc <= r; dc++) {
          if (dr * dr + dc * dc > r * r) continue;
          const rr = row + dr;
          const cc = col + dc;
          if (rr >= 0 && cc >= 0 && rr < MAP.rows && cc < MAP.cols) out[rr * MAP.cols + cc] = 1;
        }
      }
    }
  }
  return out;
})();

/** その場所に車両を置ける・走れるか（壁や棚から離れているか） */
export function isFree(p: Pt): boolean {
  const c = toCell(p);
  return !!c && !blocked[c.row * MAP.cols + c.col];
}

// 2点の間をまっすぐ走れるか（途中のマスを調べる）
function lineFree(a: { col: number; row: number }, b: { col: number; row: number }) {
  const n = Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row));
  for (let i = 1; i < n; i++) {
    const col = Math.round(a.col + ((b.col - a.col) * i) / n);
    const row = Math.round(a.row + ((b.row - a.row) * i) / n);
    if (blocked[row * MAP.cols + col]) return false;
  }
  return true;
}

/**
 * 壁を避ける経路（A*）。見つからなければ null。返す点の最初は from、最後は to。
 * 出発・到着のマスが壁に近くても、そのマス自体は通れることにする（車両がすでに壁ぎわにいることがあるため）
 */
export function planRoute(from: Pt, to: Pt): Pt[] | null {
  const s = toCell(from);
  const g = toCell(to);
  if (!s || !g) return null;
  const idx = (c: number, r: number) => r * MAP.cols + c;
  const start = idx(s.col, s.row);
  const goal = idx(g.col, g.row);
  const open = new Set<number>([start]);
  const came = new Map<number, number>();
  const gScore = new Float64Array(cells.length).fill(Infinity);
  gScore[start] = 0;
  const h = (i: number) => Math.hypot((i % MAP.cols) - g.col, Math.floor(i / MAP.cols) - g.row);
  const fScore = new Float64Array(cells.length).fill(Infinity);
  fScore[start] = h(start);

  while (open.size) {
    let cur = -1;
    for (const i of open) if (cur < 0 || fScore[i] < fScore[cur]) cur = i;
    if (cur === goal) break;
    open.delete(cur);
    const cc = cur % MAP.cols;
    const cr = Math.floor(cur / MAP.cols);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = cc + dc;
        const nr = cr + dr;
        if (nc < 0 || nr < 0 || nc >= MAP.cols || nr >= MAP.rows) continue;
        const n = idx(nc, nr);
        if (blocked[n] && n !== goal && n !== start) continue;
        const t = gScore[cur] + (dr && dc ? Math.SQRT2 : 1);
        if (t < gScore[n]) {
          came.set(n, cur);
          gScore[n] = t;
          fScore[n] = t + h(n);
          open.add(n);
        }
      }
    }
  }
  if (start !== goal && !came.has(goal)) return null;

  // マスの列 → 曲がり角だけ残す（まっすぐ走れる区間はまとめる）
  const chain: number[] = [goal];
  while (chain[0] !== start) chain.unshift(came.get(chain[0])!);
  const at = (i: number) => ({ col: i % MAP.cols, row: Math.floor(i / MAP.cols) });
  const keep = [chain[0]];
  for (let i = 1; i < chain.length - 1; i++) {
    if (!lineFree(at(keep[keep.length - 1]), at(chain[i + 1]))) keep.push(chain[i]);
  }
  const mid = keep.slice(1).map((i) => cellCenter(i % MAP.cols, Math.floor(i / MAP.cols)));
  return [{ x: from.x, y: from.y }, ...mid, { x: to.x, y: to.y }];
}

// ---------------------------------------------------------------
// 地点（waypoints.yaml）
// ---------------------------------------------------------------
type WaypointYaml = { name?: unknown; label?: unknown; x?: unknown; y?: unknown; theta_deg?: unknown; charger?: unknown; aliases?: unknown };

// 画面に出す日本語の名前：yaml に label があればそれ、無ければ日本語の別名、それも無ければ name
function labelOf(w: WaypointYaml, name: string, aliases: string[]) {
  if (typeof w.label === 'string' && w.label) return w.label;
  return aliases.find((a) => /[^\x20-\x7e]/.test(a)) ?? name;
}

export const WAYPOINTS: Waypoint[] = ((parse(waypointsText) as { waypoints?: WaypointYaml[] })?.waypoints ?? [])
  .filter((w) => typeof w.name === 'string' && typeof w.x === 'number' && typeof w.y === 'number')
  .map((w) => {
    const name = String(w.name);
    const aliases = Array.isArray(w.aliases) ? w.aliases.map(String) : [];
    return { name, label: labelOf(w, name, aliases), x: Number(w.x), y: Number(w.y), aliases, charger: w.charger === true };
  });

// 地点名か別名で探す（ROS の waypoints.yaml と同じく、別名でも指定できる）
export const wpByName = (n: string | null | undefined) => (n ? WAYPOINTS.find((w) => w.name === n || w.aliases.includes(n)) : undefined);
