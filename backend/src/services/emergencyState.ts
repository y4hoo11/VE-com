// services/emergencyState.ts
// 車両ごとに「いまの異常（ERROR）の原因」を覚えておく。
//
// ROS は、自己位置を見失った（LOCALIZATION_LOST）・障害物で進めない（BLOCKED）ときも status を ERROR にする。
// これらは原因が消えれば自動で戻る（docs/agv_protocol.md 2-3 の「ラッチしない」）。
// 見失ったときに一番必要な「現在地の設定（SET_POSE）」と「手動操縦」まで止めてしまわないよう、
// 原因がすべて下の RECOVERABLE のときだけ、ERROR でも送れるようにする。
// 緊急停止（WEB_ESTOP・ESTOP_BUTTON など解除操作が必要なもの）や、原因が分からない ERROR では今まで通り送らない。
//
// 覚えておくのはサーバーのメモリ。再起動などで覚えていないときは、DB のログ
// （最後に「緊急状態を解除」してから届いた ERROR ログの code）から読み直す。
// ROS は「見失った」を1回しか送らないので、メモリだけだと再起動後に立て直せなくなるため。
import { LogLevel } from '@prisma/client';
import { prisma } from '../config/database';

// ERROR のままでも SET_POSE・手動操縦を許す原因（どれもラッチしない）
const RECOVERABLE = new Set(['LOCALIZATION_LOST', 'BLOCKED', 'US_STOP', 'COMM_LOST']);

// 「緊急状態を解除」したときのログの書き出し（socketService の acknowledge_emergency と同じ文言）
export const ACK_LOG_PREFIX = '緊急状態を解除しました';

class EmergencyState {
  // 車両ID → 最後に解除・復帰してから届いた emergency の code
  private codes = new Map<string, Set<string>>();

  /** agv/{id}/emergency が届いた（code が無いものは「原因不明」として扱う） */
  record(vehicleId: string, code: unknown) {
    const set = this.codes.get(vehicleId) ?? new Set<string>();
    set.add(typeof code === 'string' && code ? code : 'UNKNOWN');
    this.codes.set(vehicleId, set);
  }

  /** Web から緊急停止を送った（ROS からの WEB_ESTOP を待たずに、すぐラッチ扱いにする） */
  recordWebEstop(vehicleId: string) {
    this.record(vehicleId, 'WEB_ESTOP');
  }

  /** telemetry で ERROR 以外に戻った（原因がすべて消えた） */
  clear(vehicleId: string) {
    this.codes.delete(vehicleId);
  }

  /**
   * 緊急解除した。解除の操作で片付くのは、緊急停止のような「ラッチする」原因だけ。
   * 自己位置の喪失など、まだ続いている自動で戻る原因は残す（消すと立て直しの操作まで断ってしまう）
   */
  clearLatched(vehicleId: string) {
    const set = this.codes.get(vehicleId);
    if (!set) return;
    for (const c of [...set]) if (!RECOVERABLE.has(c)) set.delete(c);
    if (!set.size) this.codes.delete(vehicleId);
  }

  /** ERROR 中でも、現在地の設定・手動操縦を送ってよいか */
  async isRecoverable(vehicleId: string) {
    const set = this.codes.get(vehicleId) ?? (await this.loadFromLogs(vehicleId));
    return !!set && set.size > 0 && [...set].every((c) => RECOVERABLE.has(c));
  }

  // メモリに無いとき：直近の ERROR ログから原因を集め直す
  //   - 解除が必要な原因（緊急停止・原因不明）… 最後の「緊急状態を解除」より後のものだけ（それより前は解除済み）
  //   - 自動で戻る原因 … 解除の前後にかかわらず数える（解除しても、原因が続いていれば ERROR のまま）
  //   - LOOKBACK_MS より古いログは使わない（分からなければ「送らない」側に倒す）
  private async loadFromLogs(vehicleId: string) {
    const LOOKBACK_MS = 10 * 60 * 1000;
    const since = new Date(Date.now() - LOOKBACK_MS);
    const ack = await prisma.vehicleLog.findFirst({
      where: { vehicleId, logLevel: LogLevel.INFO, message: { startsWith: ACK_LOG_PREFIX } },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    });
    const errors = await prisma.vehicleLog.findMany({
      where: { vehicleId, logLevel: LogLevel.ERROR, timestamp: { gt: since } },
      orderBy: { timestamp: 'desc' },
      take: 50,
      select: { details: true, timestamp: true },
    });
    const set = new Set<string>();
    for (const e of errors) {
      const raw = (e.details as { code?: unknown } | null)?.code;
      const code = typeof raw === 'string' && raw ? raw : 'UNKNOWN'; // Web の緊急停止のログ（details なし）は原因不明 = 送らない側
      const resolved = !RECOVERABLE.has(code) && !!ack && e.timestamp < ack.timestamp;
      if (!resolved) set.add(code);
    }
    if (!set.size) return null;
    this.codes.set(vehicleId, set);
    return set;
  }
}

export const emergencyState = new EmergencyState();
