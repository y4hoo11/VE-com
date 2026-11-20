// 地図と地点。ROS 側（edge_ai/ros2_ws/src/agv_navigation）の maps/*.yaml・*.pgm と地点ファイルを、ビルド時にすべて読み込む。
// ROS 側のファイルは読むだけ（書き換えない）。座標はすべて Nav2 の map 座標 [m]（telemetry の x, y と同じ）。
// 地点は config/waypoints/<地図名>.yaml、無ければ共通の config/waypoints.yaml（ROS の mission_manager と同じ選び方）。
// 表示する地図は store.ts が決めて setActiveMap() で切り替える。MAP・WAYPOINTS・isFree などは「いま表示中の地図」のもの。
// 地図を追加したら、Web を起動し直す（ビルド時に読み込むため）。
import { parse } from 'yaml';
import commonWaypointsText from '../../../edge_ai/ros2_ws/src/agv_navigation/config/waypoints.yaml?raw';
import type { Pt, Waypoint } from './data';

const MAP_YAMLS = import.meta.glob('../../../edge_ai/ros2_ws/src/agv_navigation/maps/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const MAP_PGMS = import.meta.glob('../../../edge_ai/ros2_ws/src/agv_navigation/maps/*.pgm', { query: '?inline', import: 'default', eager: true }) as Record<string, string>;
const WAYPOINT_FILES = import.meta.glob('../../../edge_ai/ros2_ws/src/agv_navigation/config/waypoints/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const stem = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
const byStem = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).map(([p, v]) => [stem(p), v]));
const yamls = byStem(MAP_YAMLS);
const pgms = byStem(MAP_PGMS);
const waypointTexts = byStem(WAYPOINT_FILES);

export const DEFAULT_MAP_ID = 'demo_map';
// 画像のある地図だけ。demo_map を先頭に、あとは名前順
export const MAP_IDS = Object.keys(yamls)
  .filter((id) => pgms[id])
  .sort((a, b) => (a === DEFAULT_MAP_ID ? -1 : b === DEFAULT_MAP_ID ? 1 : a.localeCompare(b)));
export const hasMap = (id: string | null | undefined): id is string => !!id && MAP_IDS.includes(id);

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

// 各マスの状態（行 0 が画像の上 = 地図の北）。Nav2 の trinary と同じ判定
export const CELL_FREE = 0;
export const CELL_OCCUPIED = 1;
export const CELL_UNKNOWN = 2;
export const ROBOT_RADIUS = 0.2; // [m] 壁からこれだけ離れていれば走れるとみなす

export type MapInfo = {
  id: string;
  resolution: number; // 1マスの大きさ [m]
  originX: number; // 地図の左下の座標 [m]
  originY: number;
  cols: number;
  rows: number;
  width: number; // [m]
  height: number;
  cells: Uint8Array;
};

function loadInfo(id: string): MapInfo {
  const cfg = parse(yamls[id]) as MapYaml;
  const pgm = readPgm(decodeInline(pgms[id]));
  const occThresh = cfg.occupied_thresh ?? 0.65;
  const freeThresh = cfg.free_thresh ?? 0.25;
  const cells = new Uint8Array(pgm.width * pgm.height);
  pgm.pixels.forEach((v, i) => {
    const occ = cfg.negate ? v / pgm.maxVal : (pgm.maxVal - v) / pgm.maxVal;
    cells[i] = occ > occThresh ? CELL_OCCUPIED : occ < freeThresh ? CELL_FREE : CELL_UNKNOWN;
  });
  const resolution = cfg.resolution ?? 0.05;
  return {
    id,
    resolution,
    originX: cfg.origin?.[0] ?? 0,
    originY: cfg.origin?.[1] ?? 0,
    cols: pgm.width,
    rows: pgm.height,
    width: pgm.width * resolution,
    height: pgm.height * resolution,
    cells,
  };
}

// 地図の画像（壁 = 濃い色、未知 = 薄い色、通れる所 = 透明。背景色は画面側で塗る）
function renderImage(m: MapInfo) {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = m.cols;
  canvas.height = m.rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(m.cols, m.rows);
  m.cells.forEach((c, i) => {
    const [r, g, b, a] = c === CELL_OCCUPIED ? [51, 65, 85, 255] : c === CELL_UNKNOWN ? [148, 163, 184, 90] : [0, 0, 0, 0];
    img.data.set([r, g, b, a], i * 4);
  });
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

// 壁から ROBOT_RADIUS 以内のマスを「走れない」にした地図
function makeBlocked(m: MapInfo) {
  const r = Math.ceil(ROBOT_RADIUS / m.resolution);
  const out = new Uint8Array(m.cells.length);
  for (let row = 0; row < m.rows; row++) {
    for (let col = 0; col < m.cols; col++) {
      if (m.cells[row * m.cols + col] === CELL_FREE) continue;
      for (let dr = -r; dr <= r; dr++) {
        for (let dc = -r; dc <= r; dc++) {
          if (dr * dr + dc * dc > r * r) continue;
          const rr = row + dr;
          const cc = col + dc;
          if (rr >= 0 && cc >= 0 && rr < m.rows && cc < m.cols) out[rr * m.cols + cc] = 1;
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------
// 地点（waypoints）
// ---------------------------------------------------------------
type WaypointYaml = { name?: unknown; label?: unknown; x?: unknown; y?: unknown; theta_deg?: unknown; charger?: unknown; aliases?: unknown };

// 画面に出す日本語の名前：yaml に label があればそれ、無ければ日本語の別名、それも無ければ name
function labelOf(w: WaypointYaml, name: string, aliases: string[]) {
  if (typeof w.label === 'string' && w.label) return w.label;
  return aliases.find((a) => /[^\x20-\x7e]/.test(a)) ?? name;
}

function parseWaypoints(text: string): Waypoint[] {
  return ((parse(text) as { waypoints?: WaypointYaml[] })?.waypoints ?? [])
    .filter((w) => typeof w.name === 'string' && typeof w.x === 'number' && typeof w.y === 'number')
    .map((w) => {
      const name = String(w.name);
      const aliases = Array.isArray(w.aliases) ? w.aliases.map(String) : [];
      return { name, label: labelOf(w, name, aliases), x: Number(w.x), y: Number(w.y), aliases, charger: w.charger === true };
    });
}

// ---------------------------------------------------------------
// 地図ごとの道具（座標の変換・走れるか・経路・地点）
// ---------------------------------------------------------------
export type MapApi = ReturnType<typeof makeApi>;

function makeApi(id: string) {
  const info = loadInfo(id);
  const ownWaypoints = id in waypointTexts;
  const waypoints = parseWaypoints(ownWaypoints ? waypointTexts[id] : commonWaypointsText);
  let image: string | null = null;
  let blocked: Uint8Array | null = null;
  const getBlocked = () => (blocked ??= makeBlocked(info));

  // 座標 [m] → マス（範囲外は null）
  const toCell = (p: Pt) => {
    const col = Math.floor((p.x - info.originX) / info.resolution);
    const row = info.rows - 1 - Math.floor((p.y - info.originY) / info.resolution);
    return col < 0 || row < 0 || col >= info.cols || row >= info.rows ? null : { col, row };
  };
  const cellCenter = (col: number, row: number): Pt => ({
    x: info.originX + (col + 0.5) * info.resolution,
    y: info.originY + (info.rows - 1 - row + 0.5) * info.resolution,
  });

  /** その場所に車両を置ける・走れるか（壁や棚から離れているか） */
  const isFree = (p: Pt): boolean => {
    const c = toCell(p);
    return !!c && !getBlocked()[c.row * info.cols + c.col];
  };

  // 2点の間をまっすぐ走れるか（途中のマスを調べる）
  const lineFree = (a: { col: number; row: number }, b: { col: number; row: number }) => {
    const bl = getBlocked();
    const n = Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row));
    for (let i = 1; i < n; i++) {
      const col = Math.round(a.col + ((b.col - a.col) * i) / n);
      const row = Math.round(a.row + ((b.row - a.row) * i) / n);
      if (bl[row * info.cols + col]) return false;
    }
    return true;
  };

  /**
   * 壁を避ける経路（A*）。見つからなければ null。返す点の最初は from、最後は to。
   * 出発・到着のマスが壁に近くても、そのマス自体は通れることにする（車両がすでに壁ぎわにいることがあるため）
   */
  const planRoute = (from: Pt, to: Pt): Pt[] | null => {
    const bl = getBlocked();
    const s = toCell(from);
    const g = toCell(to);
    if (!s || !g) return null;
    const idx = (c: number, r: number) => r * info.cols + c;
    const start = idx(s.col, s.row);
    const goal = idx(g.col, g.row);
    const open = new Set<number>([start]);
    const came = new Map<number, number>();
    const gScore = new Float64Array(info.cells.length).fill(Infinity);
    gScore[start] = 0;
    const h = (i: number) => Math.hypot((i % info.cols) - g.col, Math.floor(i / info.cols) - g.row);
    const fScore = new Float64Array(info.cells.length).fill(Infinity);
    fScore[start] = h(start);

    while (open.size) {
      let cur = -1;
      for (const i of open) if (cur < 0 || fScore[i] < fScore[cur]) cur = i;
      if (cur === goal) break;
      open.delete(cur);
      const cc = cur % info.cols;
      const cr = Math.floor(cur / info.cols);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = cc + dc;
          const nr = cr + dr;
          if (nc < 0 || nr < 0 || nc >= info.cols || nr >= info.rows) continue;
          const n = idx(nc, nr);
          if (bl[n] && n !== goal && n !== start) continue;
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
    const at = (i: number) => ({ col: i % info.cols, row: Math.floor(i / info.cols) });
    const keep = [chain[0]];
    for (let i = 1; i < chain.length - 1; i++) {
      if (!lineFree(at(keep[keep.length - 1]), at(chain[i + 1]))) keep.push(chain[i]);
    }
    const mid = keep.slice(1).map((i) => cellCenter(i % info.cols, Math.floor(i / info.cols)));
    return [{ x: from.x, y: from.y }, ...mid, { x: to.x, y: to.y }];
  };

  // 【仮】デモ用：車体のまわり 8 方向の、壁・棚までの距離（LiDAR の代わり）。
  // 並びは telemetry の scan8 と同じ [前, 左前, 左, 左後, 後, 右後, 右, 右前]。range [m] より遠い方向は null
  const scan8At = (p: Pt, theta: number, range = 4): (number | null)[] => {
    const step = info.resolution;
    const hit = (a: number) => {
      for (let d = step; d <= range; d += step) {
        const c = toCell({ x: p.x + d * Math.cos(a), y: p.y + d * Math.sin(a) });
        if (!c || info.cells[c.row * info.cols + c.col] === CELL_OCCUPIED) return d;
      }
      return null;
    };
    return Array.from({ length: 8 }, (_, i) => {
      let best: number | null = null;
      for (let k = -20; k <= 20; k += 5) {
        const d = hit(theta + ((i * 45 + k) * Math.PI) / 180);
        if (d != null && (best == null || d < best)) best = d;
      }
      return best == null ? null : Math.round(best * 100) / 100;
    });
  };

  // 地点名か別名で探す（ROS の waypoints.yaml と同じく、別名でも指定できる）
  const wpByName = (n: string | null | undefined) => (n ? waypoints.find((w) => w.name === n || w.aliases.includes(n)) : undefined);

  return {
    info,
    waypoints,
    ownWaypoints, // false = その地図用の地点ファイルが無く、共通の waypoints.yaml を使っている
    image: () => (image ??= renderImage(info)),
    toCell,
    isFree,
    planRoute,
    scan8At,
    wpByName,
  };
}

// 地図ごとの道具は、初めて使うときに作って取っておく
const apis = new Map<string, MapApi>();
export function mapApi(id: string): MapApi {
  const key = hasMap(id) ? id : DEFAULT_MAP_ID;
  let a = apis.get(key);
  if (!a) {
    a = makeApi(key);
    apis.set(key, a);
  }
  return a;
}

// ---------------------------------------------------------------
// いま表示中の地図（store.ts が setActiveMap で切り替える）
// ---------------------------------------------------------------
let active = mapApi(DEFAULT_MAP_ID);
export let MAP: MapInfo = active.info;
export let MAP_IMAGE: string = active.image();
export let WAYPOINTS: Waypoint[] = active.waypoints;

/** 表示する地図を切り替える。変わったら true */
export function setActiveMap(id: string): boolean {
  const next = mapApi(id);
  if (next === active) return false;
  active = next;
  MAP = next.info;
  MAP_IMAGE = next.image();
  WAYPOINTS = next.waypoints;
  return true;
}
export const activeOwnWaypoints = () => active.ownWaypoints;

export const toCell = (p: Pt) => active.toCell(p);
export const isFree = (p: Pt) => active.isFree(p);
export const planRoute = (from: Pt, to: Pt) => active.planRoute(from, to);
export const wpByName = (n: string | null | undefined) => active.wpByName(n);
export const scan8At = (p: Pt, theta: number, range?: number) => active.scan8At(p, theta, range);
