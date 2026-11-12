// controllers/changeRequestController.ts
// 設定変更の申請・承認・変更（サイン付き）。項目とランクは setting_classification.xlsx に合わせる。
//   申請 → すべての管理者に通知 → 承認（L1/L2 は1人、L3 は申請者以外の2人）→ 承認した管理者がサインして変更
//   管理者は L1・L2 なら申請なしで変更できる（その場合もサインし、direct = true で記録を残す）
import { Request, Response } from 'express';
import { ChangeRequestStatus, Prisma, ReviewDecision, Role, SettingCategory } from '@prisma/client';
import { prisma } from '../config/database';
import { socketService } from '../services/socketService';
import { loadOpsSettings } from './settingsController';

type Item = {
  label: string;
  rank: 1 | 2 | 3;
  dbKey: string; // system_settings のキー
  def: string; // まだ保存されていないときの値
  num?: { min: number; max: number; int?: boolean };
};

// 申請できる項目（L4 は企業から申請できないので入れない）
export const SETTING_ITEMS: Record<string, Item> = {
  logRetention: { label: 'ログの保存期間', rank: 1, dbKey: 'ops.log_retention_days', def: '90', num: { min: 30, max: 365, int: true } },
  battWarn: { label: 'バッテリー警告のしきい値', rank: 2, dbKey: 'ops.batt_warn', def: '30', num: { min: 10, max: 50, int: true } },
  battMin: { label: '割り当てない残量（充電に戻る基準）', rank: 2, dbKey: 'ops.batt_min', def: '20', num: { min: 10, max: 50, int: true } },
  hours: { label: '稼働時間帯（走行を許可する時間）', rank: 2, dbKey: 'ops.operating_hours', def: '終日' },
  waypoints: { label: '登録地点（経由地・目的地）の追加・位置変更', rank: 2, dbKey: 'map.waypoints_change', def: '現在の登録地点' },
  maxSpeed: { label: '最高速度（agv.max_speed）', rank: 3, dbKey: 'agv.max_speed_kmh', def: '5', num: { min: 1, max: 6 } }, // km/h（以前の agv.max_speed は m/s なので使わない）
  obstacle: { label: '障害物検知で減速・停止を始める距離', rank: 3, dbKey: 'agv.obstacle_distance', def: '0.45', num: { min: 0.2, max: 2 } },
  keepout: { label: '立入禁止エリアの追加・削除', rank: 3, dbKey: 'map.keepout_zones', def: '未設定' },
  map: { label: '使用する地図の切り替え', rank: 3, dbKey: 'map.active', def: 'warehouse_map' },
};

// 必要な承認の人数（申請者以外の管理者）
export const approvalsNeeded = (rank: number) => (rank >= 3 ? 2 : 1);

const OPEN: ChangeRequestStatus[] = [ChangeRequestStatus.PENDING, ChangeRequestStatus.APPROVED];
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** 全項目の今の値（保存されていない項目は既定値） */
export async function loadSettingValues(): Promise<Record<string, string>> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: Object.values(SETTING_ITEMS).map((i) => i.dbKey) } } });
  const out: Record<string, string> = {};
  for (const [k, i] of Object.entries(SETTING_ITEMS)) out[k] = rows.find((r) => r.key === i.dbKey)?.value ?? i.def;
  return out;
}

/** 値が範囲内か確かめる。だめならエラーの文 */
async function checkValue(key: string, raw: string): Promise<string | null> {
  const item = SETTING_ITEMS[key];
  if (!raw) return '希望する値を入力してください';
  if (raw.length > 500) return '内容が長すぎます（500文字まで）';
  if (!item.num) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || (item.num.int && !Number.isInteger(n))) return `${item.label}は${item.num.int ? '整数' : '数値'}で入力してください`;
  if (n < item.num.min || n > item.num.max) return `${item.label}は ${item.num.min}〜${item.num.max} の範囲で入力してください`;
  // バッテリーの2つは「割り当てない残量 < 警告する残量」を保つ
  if (key === 'battWarn' || key === 'battMin') {
    const ops = await loadOpsSettings();
    const warn = key === 'battWarn' ? n : ops.battWarn;
    const min = key === 'battMin' ? n : ops.battMin;
    if (min >= warn) return '「割り当てない残量」は「警告する残量」より小さくしてください';
  }
  return null;
}

/** 設定を書き換えて、全端末に知らせる */
async function writeSetting(tx: Prisma.TransactionClient, key: string, value: string, userId: string) {
  const item = SETTING_ITEMS[key];
  await tx.systemSetting.upsert({
    where: { key: item.dbKey },
    update: { value, updatedByUserId: userId },
    create: { key: item.dbKey, value, category: key.startsWith('log') ? SettingCategory.SYSTEM : SettingCategory.AGV, description: item.label, updatedByUserId: userId },
  });
}

async function broadcastSettings() {
  const [ops, values] = await Promise.all([loadOpsSettings(), loadSettingValues()]);
  socketService.broadcastSettingsChanged({ ops, values });
}

const withReviews = { reviews: { orderBy: { createdAt: 'asc' } } } satisfies Prisma.SettingChangeRequestInclude;
const findRequest = (id: string) => prisma.settingChangeRequest.findUnique({ where: { id }, include: withReviews });

// 画面に返す形（BigInt は JSON にできないので文字列にする）
type RequestRow = NonNullable<Awaited<ReturnType<typeof findRequest>>>;
const toJson = (r: RequestRow) => ({ ...r, reviews: r.reviews.map((v) => ({ ...v, id: v.id.toString() })) });

const fail = (res: Response, status: number, error: string) => res.status(status).json({ error });

/** GET /api/settings — 運行の設定と、申請できる全項目の今の値 */
export const getSettings = async (_req: Request, res: Response) => {
  try {
    const [ops, values] = await Promise.all([loadOpsSettings(), loadSettingValues()]);
    res.json({ ops, values });
  } catch (e) {
    console.error('設定の取得エラー:', e);
    fail(res, 500, '設定の取得に失敗しました');
  }
};

/**
 * GET /api/change-requests
 * 管理者はすべて（変更履歴を含む）、それ以外は自分の申請だけ。新しい順に200件
 */
export const getChangeRequests = async (req: Request, res: Response) => {
  const user = req.user!;
  try {
    const rows = await prisma.settingChangeRequest.findMany({
      where: user.role === Role.ADMIN ? {} : { requestedByUserId: user.id },
      include: withReviews,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json(rows.map(toJson));
  } catch (e) {
    console.error('申請の取得エラー:', e);
    fail(res, 500, '申請の取得に失敗しました');
  }
};

/**
 * POST /api/change-requests（ADMIN・OPERATOR）
 * ボディ: { key, value, reason, effect?, safetyRule?, pledged? }
 */
export const createChangeRequest = async (req: Request, res: Response) => {
  const user = req.user!;
  const key = text(req.body?.key);
  const item = SETTING_ITEMS[key];
  if (!item) return fail(res, 400, 'この項目は申請できません');
  const value = text(req.body?.value);
  const reason = text(req.body?.reason);
  const effect = text(req.body?.effect);
  const safetyRule = text(req.body?.safetyRule);

  const err = await checkValue(key, value);
  if (err) return fail(res, 400, err);
  if (!reason) return fail(res, 400, '理由を入力してください');
  if (item.rank >= 2 && !effect) return fail(res, 400, 'それがもたらす効果を入力してください');
  if (item.rank === 3 && !safetyRule) return fail(res, 400, '安全に関するルール案を入力してください');
  if (item.rank === 3 && req.body?.pledged !== true) return fail(res, 400, '誓約の3項目すべてに同意してください');

  try {
    const current = (await loadSettingValues())[key];
    if (current === value) return fail(res, 400, '現在の値と同じです');
    const open = await prisma.settingChangeRequest.findFirst({ where: { settingKey: key, status: { in: OPEN } } });
    if (open) return fail(res, 409, 'この項目には、処理中の申請がすでにあります');

    const created = await prisma.settingChangeRequest.create({
      data: {
        settingKey: key,
        settingLabel: item.label,
        rank: item.rank,
        currentValue: current,
        requestedValue: value,
        reason,
        effect: effect || null,
        safetyRule: safetyRule || null,
        pledgedAt: item.rank === 3 ? new Date() : null,
        requestedByUserId: user.id,
        requestedByName: user.username,
      },
      include: withReviews,
    });
    socketService.broadcastChangeRequestsChanged();
    res.status(201).json(toJson(created));
  } catch (e) {
    console.error('申請の作成エラー:', e);
    fail(res, 500, '申請の送信に失敗しました');
  }
};

/**
 * POST /api/change-requests/:id/review（ADMIN）
 * ボディ: { decision: 'APPROVE' | 'REJECT', comment? }。不承認はコメント必須。1人でも不承認なら不承認
 */
export const reviewChangeRequest = async (req: Request, res: Response) => {
  const user = req.user!;
  const id = String(req.params.id);
  const decision = req.body?.decision === 'APPROVE' ? ReviewDecision.APPROVE : req.body?.decision === 'REJECT' ? ReviewDecision.REJECT : null;
  const comment = text(req.body?.comment);
  if (!decision) return fail(res, 400, '承認か不承認かを指定してください');
  if (decision === ReviewDecision.REJECT && !comment) return fail(res, 400, '不承認の理由を入力してください');

  try {
    const r = await findRequest(id);
    if (!r) return fail(res, 404, '申請が見つかりません');
    if (r.status !== ChangeRequestStatus.PENDING) return fail(res, 409, 'この申請は承認待ちではありません');
    if (r.requestedByUserId === user.id) return fail(res, 403, '自分の申請は承認・不承認できません');
    if (r.reviews.some((v) => v.userId === user.id)) return fail(res, 409, 'この申請にはすでに回答しています');

    const approvals = r.reviews.filter((v) => v.decision === ReviewDecision.APPROVE).length + (decision === ReviewDecision.APPROVE ? 1 : 0);
    const status =
      decision === ReviewDecision.REJECT ? ChangeRequestStatus.REJECTED : approvals >= approvalsNeeded(r.rank) ? ChangeRequestStatus.APPROVED : ChangeRequestStatus.PENDING;

    await prisma.$transaction([
      prisma.settingChangeReview.create({ data: { requestId: id, userId: user.id, reviewerName: user.username, decision, comment: comment || null } }),
      prisma.settingChangeRequest.update({ where: { id }, data: { status } }),
    ]);
    socketService.broadcastChangeRequestsChanged();
    res.json(toJson((await findRequest(id))!));
  } catch (e) {
    console.error('承認の処理エラー:', e);
    fail(res, 500, '承認・不承認の処理に失敗しました');
  }
};

/** POST /api/change-requests/:id/withdraw（申請した本人。承認待ちのときだけ） */
export const withdrawChangeRequest = async (req: Request, res: Response) => {
  const user = req.user!;
  const id = String(req.params.id);
  try {
    const r = await findRequest(id);
    if (!r) return fail(res, 404, '申請が見つかりません');
    if (r.requestedByUserId !== user.id) return fail(res, 403, '自分の申請だけ取り下げられます');
    if (r.status !== ChangeRequestStatus.PENDING) return fail(res, 409, '承認待ちの申請だけ取り下げられます');
    await prisma.settingChangeRequest.update({ where: { id }, data: { status: ChangeRequestStatus.WITHDRAWN } });
    socketService.broadcastChangeRequestsChanged();
    res.json(toJson((await findRequest(id))!));
  } catch (e) {
    console.error('申請の取り下げエラー:', e);
    fail(res, 500, '申請の取り下げに失敗しました');
  }
};

// サインは「自分のユーザー名」をそのまま入力する簡易なもの
const signed = (req: Request) => text(req.body?.signature) === req.user!.username;

/**
 * POST /api/change-requests/:id/apply（ADMIN）
 * ボディ: { signature }。承認がそろった申請を、承認した管理者がサインして反映する
 */
export const applyChangeRequest = async (req: Request, res: Response) => {
  const user = req.user!;
  const id = String(req.params.id);
  if (!signed(req)) return fail(res, 400, 'サインには、あなたのユーザー名を入力してください');
  try {
    const r = await findRequest(id);
    if (!r) return fail(res, 404, '申請が見つかりません');
    if (r.status !== ChangeRequestStatus.APPROVED) return fail(res, 409, '承認がそろった申請だけ変更できます');
    if (!r.reviews.some((v) => v.userId === user.id && v.decision === ReviewDecision.APPROVE)) {
      return fail(res, 403, 'この申請を承認した管理者だけが変更できます');
    }
    if (!SETTING_ITEMS[r.settingKey]) return fail(res, 400, 'この項目は変更できません');
    // 申請してから範囲や関係する値が変わっていることがあるので、反映の直前にもう一度確かめる
    const err = await checkValue(r.settingKey, r.requestedValue);
    if (err) return fail(res, 409, `${err}（申請のあとに条件が変わりました）`);

    await prisma.$transaction(async (tx) => {
      await writeSetting(tx, r.settingKey, r.requestedValue, user.id);
      await tx.settingChangeRequest.update({
        where: { id },
        data: { status: ChangeRequestStatus.APPLIED, appliedValue: r.requestedValue, appliedByName: user.username, signature: user.username, appliedAt: new Date() },
      });
    });
    await broadcastSettings();
    socketService.broadcastChangeRequestsChanged();
    res.json(toJson((await findRequest(id))!));
  } catch (e) {
    console.error('設定の変更エラー:', e);
    fail(res, 500, '設定の変更に失敗しました');
  }
};

/**
 * POST /api/settings/direct（ADMIN）
 * ボディ: { key, value, reason?, signature }。L1・L2 を申請なしで変更し、変更の記録を残す
 */
export const directChange = async (req: Request, res: Response) => {
  const user = req.user!;
  const key = text(req.body?.key);
  const item = SETTING_ITEMS[key];
  const value = text(req.body?.value);
  if (!item) return fail(res, 400, 'この項目は変更できません');
  if (item.rank >= 3) return fail(res, 403, 'L3 の項目は、管理者でも申請と2人の承認が必要です');
  if (!signed(req)) return fail(res, 400, 'サインには、あなたのユーザー名を入力してください');
  const err = await checkValue(key, value);
  if (err) return fail(res, 400, err);

  try {
    const current = (await loadSettingValues())[key];
    if (current === value) return fail(res, 400, '現在の値と同じです');
    const open = await prisma.settingChangeRequest.findFirst({ where: { settingKey: key, status: { in: OPEN } } });
    if (open) return fail(res, 409, 'この項目には処理中の申請があります。先に申請を処理してください');

    const now = new Date();
    const created = await prisma.$transaction(async (tx) => {
      await writeSetting(tx, key, value, user.id);
      return tx.settingChangeRequest.create({
        data: {
          settingKey: key,
          settingLabel: item.label,
          rank: item.rank,
          currentValue: current,
          requestedValue: value,
          reason: text(req.body?.reason) || '管理者による直接の変更',
          status: ChangeRequestStatus.APPLIED,
          direct: true,
          requestedByUserId: user.id,
          requestedByName: user.username,
          appliedValue: value,
          appliedByName: user.username,
          signature: user.username,
          appliedAt: now,
        },
        include: withReviews,
      });
    });
    await broadcastSettings();
    socketService.broadcastChangeRequestsChanged();
    res.status(201).json(toJson(created));
  } catch (e) {
    console.error('設定の直接変更エラー:', e);
    fail(res, 500, '設定の変更に失敗しました');
  }
};
