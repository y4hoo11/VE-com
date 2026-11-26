// services/autoDispatchService.ts
// 自動割り当て：割り当て待ち（PENDING）のタスクを、出発地に一番近い空き車両へ割り当てる。
//   いつ … 数秒ごとの見回り ＋ requestDispatch()（タスクの作成・終了、車両が空いた、設定が変わった…）
//   決め方 … autoDispatchPlan.ts（優先度の高い順、予定日時が来たものだけ、直線距離で一番近い車両）
//   ON/OFF … 設定「自動割り当て」（system_settings の dispatch.auto_enabled。既定は OFF）。タスクごとに外すこともできる（tasks.auto_assign）
// 同時に2つ走らないよう、1つずつ順番に動かす（走っている間に頼まれたら、終わってからもう1回）。
// バックエンドを2つ以上同時に動かすことは考えていない（そのときは DB のロックに替える）
import { LogLevel, TaskStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { loadOpsSettings } from '../controllers/settingsController';
import { planAssignments } from './autoDispatchPlan';
import { AssignConflictError, dispatchService } from './dispatchService';
import { onDispatchRequest } from './dispatchTrigger';
import { manualDriveService } from './manualDriveService';
import { DEFAULT_MAP_ID, MAP_SETTING_KEY, mqttService } from './mqttService';
import { socketService } from './socketService';
import { waypointService } from './waypointService';

export const AUTO_DISPATCH_KEY = 'dispatch.auto_enabled'; // 値は ON / OFF
export const AUTO_DISPATCH_DEFAULT = 'OFF';
const INTERVAL_MS = Number(process.env.AUTO_DISPATCH_INTERVAL_MS) || 3000;

class AutoDispatchService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private again = false;
  private enabled = false;
  private lastRunAt: Date | null = null;
  // 割り当てていないタスク → 理由（タスク一覧に出す）
  private waiting = new Map<string, string>();

  start() {
    if (this.timer) return;
    onDispatchRequest((reason) => this.kick(reason));
    this.timer = setInterval(() => this.kick('定期'), INTERVAL_MS);
    console.log(`[自動割り当て] 開始（${INTERVAL_MS / 1000}秒ごとに見回り。ON/OFF は設定「自動割り当て」）`);
    this.kick('起動');
  }

  /** 割り当てをやり直す。走っている最中なら、終わってからもう1回だけ走る */
  kick(_reason: string) {
    if (this.running) {
      this.again = true;
      return;
    }
    void this.loop();
  }

  /** すぐに1回走らせて、割り当てた件数を返す（POST /api/dispatch/auto/run） */
  async runNow(): Promise<number> {
    while (this.running) await new Promise((r) => setTimeout(r, 50));
    this.running = true;
    try {
      return await this.runOnce();
    } finally {
      this.running = false;
    }
  }

  /** タスク一覧に出す「割り当てていない理由」 */
  noteFor(taskId: string): string | null {
    return this.waiting.get(taskId) ?? null;
  }

  status() {
    return {
      enabled: this.enabled,
      intervalMs: INTERVAL_MS,
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      waiting: Object.fromEntries(this.waiting),
    };
  }

  private async loop() {
    this.running = true;
    try {
      do {
        this.again = false;
        await this.runOnce();
      } while (this.again);
    } catch (e) {
      console.error('[自動割り当て] エラー:', e);
    } finally {
      this.running = false;
    }
  }

  private async isEnabled() {
    const row = await prisma.systemSetting.findUnique({ where: { key: AUTO_DISPATCH_KEY } });
    return (row?.value ?? AUTO_DISPATCH_DEFAULT) === 'ON';
  }

  private setWaiting(next: Map<string, string>) {
    const key = (m: Map<string, string>) => JSON.stringify([...m].sort(([a], [b]) => a.localeCompare(b)));
    const changed = key(next) !== key(this.waiting);
    this.waiting = next;
    if (changed) socketService.broadcastTasksChanged(); // 画面のタスク一覧の「理由」を出し直す
  }

  /** 1回分。割り当てた件数を返す */
  private async runOnce(): Promise<number> {
    this.lastRunAt = new Date();
    this.enabled = await this.isEnabled();
    if (!this.enabled) {
      this.setWaiting(new Map());
      return 0;
    }

    const tasks = await prisma.task.findMany({
      where: { status: TaskStatus.PENDING, autoAssign: true },
      select: { id: true, title: true, priority: true, startLocation: true, targetLocation: true, scheduledAt: true, createdAt: true },
    });
    if (tasks.length === 0) {
      this.setWaiting(new Map());
      return 0;
    }
    // ブローカーにつながっていないと TASK_ASSIGN が車両に届かないので、割り当てない
    if (!mqttService.isConnected()) {
      this.setWaiting(new Map(tasks.map((t) => [t.id, 'MQTTブローカーにつながっていないため待っています'])));
      return 0;
    }

    const [vehicles, busyRows, ops, mapRow] = await Promise.all([
      prisma.vehicle.findMany({ select: { id: true, status: true, batteryLevel: true, currentX: true, currentY: true, currentMapId: true } }),
      prisma.task.findMany({
        where: { status: { in: [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS] }, assignedVehicleId: { not: null } },
        select: { assignedVehicleId: true },
      }),
      loadOpsSettings(),
      prisma.systemSetting.findUnique({ where: { key: MAP_SETTING_KEY } }),
    ]);
    const activeMapId = mapRow?.value || DEFAULT_MAP_ID;
    const ids = vehicles.map((v) => v.id);

    const plan = planAssignments(tasks, vehicles, {
      now: new Date(),
      battMin: ops.battMin,
      battWarn: ops.battWarn,
      activeMapId,
      busyVehicleIds: new Set(busyRows.map((r) => r.assignedVehicleId!)),
      manualVehicleIds: new Set(ids.filter((id) => manualDriveService.isDriving(id))),
      movingVehicleIds: new Set(ids.filter((id) => mqttService.hasPendingMove(id) === true)),
      resolve: (name) => waypointService.find(activeMapId, name),
    });

    let assigned = 0;
    for (const a of plan.assignments) {
      const t = tasks.find((x) => x.id === a.taskId)!;
      const v = vehicles.find((x) => x.id === a.vehicleId)!;
      const reason = `${t.startLocation} まで約 ${a.distance.toFixed(1)} m、電池 ${v.batteryLevel}%`;
      try {
        await dispatchService.assignTask(a.taskId, a.vehicleId, { source: 'auto', reason });
        assigned++;
      } catch (e) {
        if (e instanceof AssignConflictError) {
          // 手動の割り当て・中止と同時だった。次の回で決め直す
          plan.waiting.set(a.taskId, '割り当てを決め直しています');
          this.again = true;
        } else {
          console.error(`[自動割り当て] ${a.taskId} → ${a.vehicleId} に失敗しました:`, e);
          plan.waiting.set(a.taskId, '割り当てに失敗しました（サーバーのログを確認してください）');
          await socketService.recordLog(a.vehicleId, LogLevel.ERROR, `タスク [${t.title}] の自動割り当てに失敗しました`).catch(() => {});
        }
      }
    }
    this.setWaiting(plan.waiting);
    return assigned;
  }
}

export const autoDispatchService = new AutoDispatchService();
