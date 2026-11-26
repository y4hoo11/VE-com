// routes/index.ts
import { Router } from 'express';
import { readFileSync } from 'fs';
import path from 'path';
import { Role } from '@prisma/client';
import { getVehicles, getVehicleById, createVehicle, updateVehicle, deleteVehicle, setVehicleTestOnline } from '../controllers/agvController';
import { getTasks, getTaskById, createTask, assignTask, deleteTask, updateTask } from '../controllers/taskController';
import { getLogs } from '../controllers/logController';
import { login } from '../controllers/authController';
import { getSettings, getChangeRequests, createChangeRequest, reviewChangeRequest, withdrawChangeRequest, applyChangeRequest, directChange } from '../controllers/changeRequestController';
import { getUsers, createUser, updateUser, deleteUser, getMe, changeMyPassword } from '../controllers/userController';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();

// サーバー（backend）の版。設定画面の「バージョン」に出す（src/routes でも dist/routes でも 2 つ上が backend）
const SERVER_INFO = (() => {
  let version = '不明';
  try {
    version = (JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8')) as { version: string }).version;
  } catch {
    /* 読めなければ「不明」 */
  }
  return { version, node: process.version, startedAt: new Date().toISOString() };
})();

// 認証API（ログイン前に使うので、ここだけはトークン不要）
router.post('/login', login);

// ↓ これより下のAPIはすべてログイン必須
router.use(requireAuth);

router.get('/me', getMe);
router.get('/version', (_req, res) => res.json(SERVER_INFO)); // サーバーの版・Node.js の版・起動した日時
router.put('/me/password', changeMyPassword); // 自分のパスワードの変更

// ユーザー管理API（ADMIN のみ）
router.get('/users', requireRole(Role.ADMIN), getUsers);
router.post('/users', requireRole(Role.ADMIN), createUser);
router.patch('/users/:id', requireRole(Role.ADMIN), updateUser);
router.delete('/users/:id', requireRole(Role.ADMIN), deleteUser);

// 車両API
router.get('/vehicles', getVehicles);
router.get('/vehicles/:id', getVehicleById);
router.post('/vehicles', requireRole(Role.ADMIN), createVehicle);
router.patch('/vehicles/:id', requireRole(Role.ADMIN), updateVehicle);
router.delete('/vehicles/:id', requireRole(Role.ADMIN), deleteVehicle);
router.post('/vehicles/:id/test-online', requireRole(Role.ADMIN), setVehicleTestOnline); // 【仮】テスト用

// タスクAPI（読むのは全員、作成・割り当て・編集・中止は ADMIN と OPERATOR。VIEWER は見るだけ）
const canOperate = requireRole(Role.ADMIN, Role.OPERATOR);
router.get('/tasks', getTasks);
router.post('/tasks', canOperate, createTask);
router.post('/tasks/assign', canOperate, assignTask);
router.get('/tasks/:id', getTaskById);
router.delete('/tasks/:id', canOperate, deleteTask); // 未割当・割当済は取り消し、実行中は中止（CANCEL_TASK）
router.patch('/tasks/:id', canOperate, updateTask);

// ログAPI
router.get('/logs', getLogs);

// 設定API（読むのは全員。変更はサイン付きで、申請・承認を通すか、管理者が L1・L2 を直接変更する）
router.get('/settings', getSettings);
router.post('/settings/direct', requireRole(Role.ADMIN), directChange);

// 設定変更の申請API（申請は ADMIN と OPERATOR、承認・変更は ADMIN）
router.get('/change-requests', getChangeRequests);
router.post('/change-requests', canOperate, createChangeRequest);
router.post('/change-requests/:id/review', requireRole(Role.ADMIN), reviewChangeRequest);
router.post('/change-requests/:id/withdraw', canOperate, withdrawChangeRequest);
router.post('/change-requests/:id/apply', requireRole(Role.ADMIN), applyChangeRequest);

export default router;
