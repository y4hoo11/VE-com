// services/waypointService.ts
// 地点名（タスクの startLocation / targetLocation）→ 地図の座標 [m]。自動割り当てで「出発地まで何 m か」を出すのに使う。
// 地点は ROS の mission_manager と同じファイルを読む：config/waypoints/<地図名>.yaml、無ければ共通の config/waypoints.yaml
// 名前の引き方も agv_navigation/waypoints.py の WaypointBook.find と同じ（名前か別名。大文字・小文字は区別しない）
import fs from 'fs';
import path from 'path';
import { parse } from 'yaml';

export interface Waypoint {
  name: string;
  x: number;
  y: number;
  aliases: string[];
  charger: boolean;
}

// 既定は monorepo の中の agv_navigation/config。バックエンドを別の場所で動かすときは WAYPOINTS_DIR で変える
const CONFIG_DIR = process.env.WAYPOINTS_DIR || path.resolve(__dirname, '../../../edge_ai/ros2_ws/src/agv_navigation/config');

type Cache = { file: string; mtimeMs: number; items: Waypoint[] };

function readItems(file: string): Waypoint[] {
  const data = (parse(fs.readFileSync(file, 'utf-8')) ?? {}) as { waypoints?: unknown };
  const list = Array.isArray(data.waypoints) ? data.waypoints : [];
  return list.flatMap((w: any) => {
    const x = Number(w?.x);
    const y = Number(w?.y);
    if (w?.name == null || !Number.isFinite(x) || !Number.isFinite(y)) return [];
    return [{ name: String(w.name), x, y, charger: Boolean(w.charger), aliases: Array.isArray(w.aliases) ? w.aliases.map(String) : [] }];
  });
}

class WaypointService {
  private cache = new Map<string, Cache>();

  /** その地図で使う地点ファイル（無ければ null） */
  fileFor(mapId: string): string | null {
    const perMap = path.join(CONFIG_DIR, 'waypoints', `${mapId}.yaml`);
    if (fs.existsSync(perMap)) return perMap;
    const common = path.join(CONFIG_DIR, 'waypoints.yaml');
    return fs.existsSync(common) ? common : null;
  }

  /** その地図の地点の一覧。ファイルが書き換わっていたら読み直す（サーバーを再起動しなくてよいように） */
  list(mapId: string): Waypoint[] {
    const file = this.fileFor(mapId);
    if (!file) {
      this.cache.delete(mapId);
      return [];
    }
    try {
      const mtimeMs = fs.statSync(file).mtimeMs;
      const hit = this.cache.get(mapId);
      if (hit && hit.file === file && hit.mtimeMs === mtimeMs) return hit.items;
      const items = readItems(file);
      this.cache.set(mapId, { file, mtimeMs, items });
      console.log(`[地点] 地図 ${mapId}: ${items.length} 件を読み込みました（${file}）`);
      return items;
    } catch (e) {
      console.error(`[地点] ${file} を読めませんでした:`, e);
      return this.cache.get(mapId)?.items ?? [];
    }
  }

  /** 地点名か別名で探す。見つからなければ null */
  find(mapId: string, name: string | null | undefined): Waypoint | null {
    if (name == null) return null;
    const key = name.trim().toLowerCase();
    if (!key) return null;
    return this.list(mapId).find((w) => w.name.toLowerCase() === key || w.aliases.some((a) => a.toLowerCase() === key)) ?? null;
  }
}

export const waypointService = new WaypointService();
