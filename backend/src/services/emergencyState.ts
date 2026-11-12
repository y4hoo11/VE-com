// services/emergencyState.ts
// 車両ごとに「いまの異常（ERROR）の原因」を覚えておく（サーバーのメモリだけ。再起動すると忘れる）。
//
// ROS は、自己位置を見失った（LOCALIZATION_LOST）・障害物で進めない（BLOCKED）ときも status を ERROR にする。
// これらは原因が消えれば自動で戻る（docs/agv_protocol.md 2-3 の「ラッチしない」）。
// 見失ったときに一番必要な「現在地の設定（SET_POSE）」と「手動操縦」まで止めてしまわないよう、
// 原因がすべて下の RECOVERABLE のときだけ、ERROR でも送れるようにする。
// 緊急停止（WEB_ESTOP・ESTOP_BUTTON など解除操作が必要なもの）や、原因が分からない ERROR では今まで通り送らない。

// ERROR のままでも SET_POSE・手動操縦を許す原因（どれもラッチしない）
const RECOVERABLE = new Set(['LOCALIZATION_LOST', 'BLOCKED', 'US_STOP', 'COMM_LOST']);

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

  /** 緊急解除した・telemetry で ERROR 以外に戻った */
  clear(vehicleId: string) {
    this.codes.delete(vehicleId);
  }

  /** ERROR 中でも、現在地の設定・手動操縦を送ってよいか */
  isRecoverable(vehicleId: string) {
    const set = this.codes.get(vehicleId);
    return !!set && set.size > 0 && [...set].every((c) => RECOVERABLE.has(c));
  }
}

export const emergencyState = new EmergencyState();
