// controllers/settingsController.ts
// 運行の設定（バッテリーのしきい値など）。system_settings テーブルに保存し、全端末で共有する
// 変更はサイン付きの変更だけ（changeRequestController.ts）。ここは読むだけ
import { prisma } from '../config/database';

export interface OpsSettings {
  battWarn: number; // これより少ないと警告（黄色）
  battMin: number; // これより少ない車両にはタスクを割り当てない（赤）
}

export const OPS_DEFAULTS: OpsSettings = { battWarn: 30, battMin: 20 };

// system_settings のキー
const KEYS: Record<keyof OpsSettings, string> = {
  battWarn: 'ops.batt_warn',
  battMin: 'ops.batt_min',
};

/** 運行の設定を読む（保存されていない項目は既定値） */
export async function loadOpsSettings(): Promise<OpsSettings> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: Object.values(KEYS) } },
  });
  const read = (k: keyof OpsSettings) => {
    const n = Number(rows.find((r) => r.key === KEYS[k])?.value);
    return Number.isFinite(n) ? n : OPS_DEFAULTS[k];
  };
  return { battWarn: read('battWarn'), battMin: read('battMin') };
}

