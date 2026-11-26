// services/autoDispatchPlan.ts
// 割り当ての「決め方」だけを書いたところ。DB・MQTT には触らない（テストしやすいように）
//   - vehicleBlocker … その車両に割り当てられない理由（手動の割り当てと自動割り当ての両方で使う）
//   - planAssignments … 割り当て待ちのタスクを、どの車両に渡すか決める（自動割り当て）
import { VehicleStatus } from '@prisma/client';

export interface Point {
  x: number;
  y: number;
}

export interface PlanVehicle {
  id: string;
  status: VehicleStatus;
  batteryLevel: number;
  currentX: number;
  currentY: number;
  currentMapId: string | null;
}

export interface PlanTask {
  id: string;
  priority: number;
  startLocation: string | null;
  targetLocation: string | null;
  scheduledAt: Date | null;
  createdAt: Date;
}

export interface BlockerContext {
  battMin: number; // これ未満の電池残量の車両には割り当てない
  busyVehicleIds: ReadonlySet<string>; // ASSIGNED / IN_PROGRESS のタスクを持っている車両
  manualVehicleIds: ReadonlySet<string>; // 手動操縦中の車両
}

export interface PlanContext extends BlockerContext {
  now: Date;
  battWarn: number; // 充電中の車両は、これ以上たまっていれば使う
  activeMapId: string; // 全車両が使っている地図（設定「使用する地図の切り替え」）
  movingVehicleIds: ReadonlySet<string>; // 地点へ移動・ホームへ戻るなど、タスクでない移動の途中の車両
  resolve: (name: string | null) => Point | null; // 地点名 → 座標（今の地図で）
}

export interface Assignment {
  taskId: string;
  vehicleId: string;
  distance: number; // 出発地までの直線距離 [m]
}

export interface PlanResult {
  assignments: Assignment[];
  waiting: Map<string, string>; // 割り当てなかったタスク → 理由（画面に出す）
}

/**
 * その車両に割り当てられない理由。割り当てられるなら null。
 * auto = true のとき（自動割り当て）は、人なら判断できる場合も避ける：
 * 走行中・移動中・充電がたまっていない・別の地図にいる
 */
export function vehicleBlocker(v: PlanVehicle, ctx: BlockerContext, auto?: PlanContext): string | null {
  if (v.status === VehicleStatus.OFFLINE) return 'オフライン';
  if (v.status === VehicleStatus.ERROR) return '異常中';
  if (ctx.busyVehicleIds.has(v.id)) return '別のタスクを実行中';
  if (ctx.manualVehicleIds.has(v.id)) return '手動操縦中';
  if (v.batteryLevel < ctx.battMin) return `電池残量が ${ctx.battMin}% 未満`;
  if (!auto) return null;

  if (v.status === VehicleStatus.RUNNING || auto.movingVehicleIds.has(v.id)) return '移動中';
  if (v.status === VehicleStatus.CHARGING && v.batteryLevel < auto.battWarn) return `充電中（${auto.battWarn}% 未満）`;
  // 地図を知らせてこない車両（ラズパイだけで動かしているときなど）は、今の地図にいるものとみなす
  if (v.currentMapId && v.currentMapId !== auto.activeMapId) return `別の地図（${v.currentMapId}）にいる`;
  return null;
}

/** 割り当てる順番：優先度の高い順 → 予定日時の早い順（無いものは後）→ 作成の古い順 */
export function compareTasks(a: PlanTask, b: PlanTask): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const sa = a.scheduledAt?.getTime() ?? Infinity;
  const sb = b.scheduledAt?.getTime() ?? Infinity;
  if (sa !== sb) return sa - sb;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * 割り当て待ちのタスクを順番に見て、空いている車両のうち出発地に一番近い（直線距離）1台に渡す。
 * 距離が同じなら電池が多い方。1台に渡すのは1タスクまで（同じ回の中で使った車両は外す）
 */
export function planAssignments(tasks: PlanTask[], vehicles: PlanVehicle[], ctx: PlanContext): PlanResult {
  const waiting = new Map<string, string>();
  const assignments: Assignment[] = [];
  const free = vehicles.filter((v) => !vehicleBlocker(v, ctx, ctx));

  for (const t of [...tasks].sort(compareTasks)) {
    if (t.scheduledAt && t.scheduledAt.getTime() > ctx.now.getTime()) {
      waiting.set(t.id, '予定日時になったら割り当てます');
      continue;
    }
    const start = ctx.resolve(t.startLocation);
    if (!start) {
      waiting.set(t.id, `出発地「${t.startLocation ?? '未設定'}」が地図 ${ctx.activeMapId} にありません`);
      continue;
    }
    if (!ctx.resolve(t.targetLocation)) {
      waiting.set(t.id, `目的地「${t.targetLocation ?? '未設定'}」が地図 ${ctx.activeMapId} にありません`);
      continue;
    }

    let best: PlanVehicle | null = null;
    let bestDist = Infinity;
    for (const v of free) {
      const d = Math.hypot(v.currentX - start.x, v.currentY - start.y);
      if (d < bestDist || (d === bestDist && best && v.batteryLevel > best.batteryLevel)) {
        best = v;
        bestDist = d;
      }
    }
    if (!best) {
      waiting.set(t.id, '空いている車両がありません');
      continue;
    }
    assignments.push({ taskId: t.id, vehicleId: best.id, distance: bestDist });
    free.splice(free.indexOf(best), 1);
  }
  return { assignments, waiting };
}
