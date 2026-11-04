// controllers/settingsController.ts
// 運行の設定（バッテリーのしきい値など）。system_settings テーブルに保存し、全端末で共有する
import { Request, Response } from 'express';
import { SettingCategory } from '@prisma/client';
import { prisma } from '../config/database';
import { socketService } from '../services/socketService';

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
const DESCRIPTIONS: Record<keyof OpsSettings, string> = {
  battWarn: 'バッテリー：警告する残量（%）',
  battMin: 'バッテリー：割り当てない残量（%）',
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

/** GET /api/settings */
export const getSettings = async (_req: Request, res: Response) => {
  try {
    res.json({ ops: await loadOpsSettings() });
  } catch (error) {
    console.error('設定の取得エラー:', error);
    res.status(500).json({ error: '設定の取得に失敗しました' });
  }
};

/**
 * PUT /api/settings（ADMIN のみ）
 * ボディ: { ops: { battWarn, battMin } }
 */
export const updateSettings = async (req: Request, res: Response) => {
  const ops = (req.body?.ops ?? {}) as Record<string, unknown>;
  const battWarn = Number(ops.battWarn);
  const battMin = Number(ops.battMin);

  if (!Number.isInteger(battWarn) || battWarn < 5 || battWarn > 90) {
    return res.status(400).json({ error: '「警告する残量」は 5〜90 の整数にしてください' });
  }
  if (!Number.isInteger(battMin) || battMin < 0 || battMin > 80) {
    return res.status(400).json({ error: '「割り当てない残量」は 0〜80 の整数にしてください' });
  }
  if (battMin >= battWarn) {
    return res.status(400).json({ error: '「割り当てない残量」は「警告する残量」より小さくしてください' });
  }

  const saved: OpsSettings = { battWarn, battMin };
  try {
    await prisma.$transaction(
      (Object.keys(KEYS) as (keyof OpsSettings)[]).map((k) =>
        prisma.systemSetting.upsert({
          where: { key: KEYS[k] },
          update: { value: String(saved[k]), updatedByUserId: req.user?.id ?? null },
          create: {
            key: KEYS[k],
            value: String(saved[k]),
            category: SettingCategory.AGV,
            description: DESCRIPTIONS[k],
            updatedByUserId: req.user?.id ?? null,
          },
        })
      )
    );
    socketService.broadcastSettingsChanged({ ops: saved });
    res.json({ ops: saved });
  } catch (error) {
    console.error('設定の保存エラー:', error);
    res.status(500).json({ error: '設定の保存に失敗しました' });
  }
};
