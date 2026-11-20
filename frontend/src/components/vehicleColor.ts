import { COL, PAUSED_COL, type Vehicle } from '../store/data';

// 車両の状態を表す色（地図の車両と同じ）。一時停止中は専用の色
export function vehicleColor(v: Vehicle): string {
  return v.paused && v.status === 'RUNNING' ? PAUSED_COL : COL[v.status];
}