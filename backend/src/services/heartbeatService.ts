// services/heartbeatService.ts
// 車両のオフライン検知。telemetry（PC1 は 2Hz、ラズパイは 1Hz）が一定時間届かない車両を OFFLINE にする
import { prisma } from '../config/database';
import { VehicleStatus, LogLevel } from '@prisma/client';
import { socketService } from './socketService';

export const OFFLINE_AFTER_MS = 5000; // これだけ telemetry が来なければオフライン
const CHECK_INTERVAL_MS = 1000;

// ERROR の車両は対象外にする（緊急状態は人が確認して解除するまで残すため）
const WATCHED_STATUSES = [VehicleStatus.IDLE, VehicleStatus.RUNNING, VehicleStatus.CHARGING];

class HeartbeatService {
  private timer: NodeJS.Timeout | null = null;
  private checking = false;
  // 【仮】テスト用：画面から手動でオンラインにした車両。telemetry が無くてもオフラインにしない
  // サーバーを再起動すると消える（tsx watch はファイル保存でも再起動する）
  private testOnline = new Set<string>();

  // 【仮】テスト用
  setTestOnline(id: string, on: boolean) {
    if (on) this.testOnline.add(id);
    else this.testOnline.delete(id);
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.check().catch((e) => console.error('オフライン検知のエラー:', e));
    }, CHECK_INTERVAL_MS);
    console.log(`[オフライン検知] 開始（${OFFLINE_AFTER_MS / 1000}秒 telemetry が無ければオフライン）`);
  }

  private async check() {
    if (this.checking) return; // 前回の確認が終わっていなければ飛ばす
    this.checking = true;
    try {
      const limit = new Date(Date.now() - OFFLINE_AFTER_MS);
      const stale = {
        status: { in: WATCHED_STATUSES },
        id: { notIn: [...this.testOnline] }, // 【仮】テスト用
        OR: [{ lastHeartbeat: null }, { lastHeartbeat: { lt: limit } }],
      };
      const targets = await prisma.vehicle.findMany({ where: stale, select: { id: true } });

      for (const { id } of targets) {
        // 確認している間に telemetry が届いた車両は変えない
        const r = await prisma.vehicle.updateMany({
          where: { AND: [{ id }, stale] },
          data: { status: VehicleStatus.OFFLINE },
        });
        if (r.count === 0) continue;

        socketService.broadcastVehicleUpdate({ id, status: VehicleStatus.OFFLINE });
        await socketService.recordLog(
          id,
          LogLevel.WARN,
          `通信が${OFFLINE_AFTER_MS / 1000}秒以上届かないため、オフラインにしました`
        );
      }
    } finally {
      this.checking = false;
    }
  }
}

export const heartbeatService = new HeartbeatService();
