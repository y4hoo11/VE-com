// routes/index.ts
import { Router } from 'express';
import { Role } from '@prisma/client';
import { getVehicles, getVehicleById, createVehicle, updateVehicle, deleteVehicle, setVehicleTestOnline } from '../controllers/agvController';
import { getTasks, getTaskById, createTask, assignTask, deleteTask, updateTask } from '../controllers/taskController';
import { getLogs } from '../controllers/logController';
import { login } from '../controllers/authController';
import { getSettings, updateSettings } from '../controllers/settingsController';
import { getUsers, createUser, updateUser, deleteUser, getMe, changeMyPassword } from '../controllers/userController';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();

// 認証API（ログイン前に使うので、ここだけはトークン不要）
router.post('/login', login);

// ↓ これより下のAPIはすべてログイン必須
router.use(requireAuth);

router.get('/me', getMe);
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

// 運行の設定API（読むのは全員、変えるのは ADMIN だけ）
router.get('/settings', getSettings);
router.put('/settings', requireRole(Role.ADMIN), updateSettings);

export default router;
