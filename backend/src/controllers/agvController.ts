// agvController.ts
import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { TaskStatus, VehicleStatus, LogLevel } from '@prisma/client';
import { socketService } from '../services/socketService';
import { heartbeatService } from '../services/heartbeatService';

export const getVehicles = async (req: Request, res: Response) => {
  try {
    const vehicles = await prisma.vehicle.findMany({
      orderBy: { id: 'asc' },
    });
    res.json(vehicles);
  } catch (error) {
    res.status(500).json({ error: '車両一覧の取得に失敗しました' });
  }
};

export const getVehicleById = async (req: Request, res: Response) => {
  const { id } = req.params;
  const vehicleId = Array.isArray(id) ? id[0] : id;

  if (!vehicleId) {
    return res.status(400).json({ error: '無効な車両IDです' });
  }

  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      include: {
        tasks: { take: 10, orderBy: { createdAt: 'desc' } },
      },
    });

    if (!vehicle) {
      return res.status(404).json({ error: '車両が見つかりません' });
    }

    const safeVehicle = JSON.parse(
      JSON.stringify(vehicle, (_, value) =>
        typeof value === 'bigint' ? value.toString() : value
      )
    );

    res.json(safeVehicle);
  } catch (error) {
    try {
      // 修正箇所: req.params.id ではなく型安全な vehicleId を使用
      const fallbackVehicle = await prisma.vehicle.findUnique({
        where: { id: vehicleId },
      });
      if (!fallbackVehicle) return res.status(404).json({ error: '車両が見つかりません' });
      return res.json(fallbackVehicle);
    } catch (fallbackError) {
      console.error('getVehicleById エラー:', error);
      return res.status(500).json({ error: '車両詳細の取得に失敗しました' });
    }
  }
};

// ---------------------------------------------------------------
// 車両の登録・編集・削除（ADMIN のみ。routes で制限する）
// ---------------------------------------------------------------
const VEHICLE_ID_RE = /^AGV-\d{2}$/; // MQTT のトピック agv/{ID}/… に使う
const NAME_MAX = 50;

const getIdParam = (id: unknown): string | undefined => {
  if (typeof id === 'string') return id;
  if (Array.isArray(id) && typeof id[0] === 'string') return id[0];
  return undefined;
};

const readName = (name: unknown): string | null => {
  if (typeof name !== 'string') return null;
  const t = name.trim();
  return t && t.length <= NAME_MAX ? t : null;
};

/** POST /api/vehicles  ボディ: { id, name } */
export const createVehicle = async (req: Request, res: Response) => {
  const id = typeof req.body?.id === 'string' ? req.body.id.trim().toUpperCase() : '';
  const name = readName(req.body?.name);

  if (!VEHICLE_ID_RE.test(id)) {
    return res.status(400).json({ error: '車両IDは「AGV-数字2桁」の形にしてください（例: AGV-05）' });
  }
  if (!name) {
    return res.status(400).json({ error: `表示名は1〜${NAME_MAX}文字で入力してください` });
  }

  try {
    const exists = await prisma.vehicle.findUnique({ where: { id } });
    if (exists) return res.status(409).json({ error: 'その車両IDはすでに登録されています' });

    // まだ一度も通信していないので、オフラインで登録する（telemetry が届けば自動で切り替わる）
    const vehicle = await prisma.vehicle.create({
      data: { id, name, status: VehicleStatus.OFFLINE },
    });
    socketService.broadcastVehiclesChanged();
    res.status(201).json(vehicle);
  } catch (error) {
    console.error('車両の登録エラー:', error);
    res.status(500).json({ error: '車両の登録に失敗しました' });
  }
};

/** PATCH /api/vehicles/:id  ボディ: { name } */
export const updateVehicle = async (req: Request, res: Response) => {
  const id = getIdParam(req.params.id);
  const name = readName(req.body?.name);
  if (!id) return res.status(400).json({ error: '無効な車両IDです' });
  if (!name) return res.status(400).json({ error: `表示名は1〜${NAME_MAX}文字で入力してください` });

  try {
    const exists = await prisma.vehicle.findUnique({ where: { id } });
    if (!exists) return res.status(404).json({ error: '車両が見つかりません' });

    const vehicle = await prisma.vehicle.update({ where: { id }, data: { name } });
    socketService.broadcastVehicleUpdate({ id, name });
    res.json(vehicle);
  } catch (error) {
    console.error('車両の更新エラー:', error);
    res.status(500).json({ error: '車両の更新に失敗しました' });
  }
};

/**
 * DELETE /api/vehicles/:id
 * 実行中・割当済のタスクがある車両は消せない。消すとその車両のログも消える（vehicle_logs は Cascade）
 */
export const deleteVehicle = async (req: Request, res: Response) => {
  const id = getIdParam(req.params.id);
  if (!id) return res.status(400).json({ error: '無効な車両IDです' });

  try {
    const exists = await prisma.vehicle.findUnique({ where: { id } });
    if (!exists) return res.status(404).json({ error: '車両が見つかりません' });

    const active = await prisma.task.count({
      where: { assignedVehicleId: id, status: { in: [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS] } },
    });
    if (active > 0) {
      return res.status(409).json({ error: '割り当て済み・実行中のタスクがあるため削除できません。先にタスクを中止してください' });
    }

    await prisma.vehicle.delete({ where: { id } });
    socketService.broadcastVehiclesChanged();
    res.json({ ok: true });
  } catch (error) {
    console.error('車両の削除エラー:', error);
    res.status(500).json({ error: '車両の削除に失敗しました' });
  }
};

// ---------------------------------------------------------------
// 【仮】テスト用：車両を手動でオンライン／オフラインにする（実機なしで画面の動きを確かめるため）
// POST /api/vehicles/:id/test-online  ボディ: { online: boolean }（ADMIN のみ）
// オンラインにした車両は、telemetry が来なくてもオフライン検知の対象から外す（サーバー再起動で元に戻る）
// 実機の確認ができるようになったら、この関数・ルート・画面のボタンを消す
// ---------------------------------------------------------------
export const setVehicleTestOnline = async (req: Request, res: Response) => {
  const id = getIdParam(req.params.id);
  const online = req.body?.online;
  if (!id) return res.status(400).json({ error: '無効な車両IDです' });
  if (typeof online !== 'boolean') return res.status(400).json({ error: 'online は true / false で指定してください' });

  try {
    const v = await prisma.vehicle.findUnique({ where: { id } });
    if (!v) return res.status(404).json({ error: '車両が見つかりません' });
    if (v.status === VehicleStatus.ERROR) {
      return res.status(409).json({ error: '異常中の車両は切り替えられません。先に緊急状態を解除してください' });
    }

    heartbeatService.setTestOnline(id, online);
    // オンラインにするときは待機（IDLE）にする。実行中など、すでにオンラインの状態ならそのまま
    const status = online ? (v.status === VehicleStatus.OFFLINE ? VehicleStatus.IDLE : v.status) : VehicleStatus.OFFLINE;
    const updated = await prisma.vehicle.update({
      where: { id },
      data: { status, ...(online ? { lastHeartbeat: new Date() } : {}) },
    });

    socketService.broadcastVehicleUpdate({ id, status });
    await socketService.recordLog(
      id,
      LogLevel.INFO,
      `【テスト】手動で${online ? 'オンライン' : 'オフライン'}にしました（操作: ${req.user?.username ?? '不明'}）`
    );
    res.json(updated);
  } catch (error) {
    console.error('オンライン切り替えエラー:', error);
    res.status(500).json({ error: 'オンライン・オフラインの切り替えに失敗しました' });
  }
};
