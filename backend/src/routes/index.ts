// routes/index.ts
import { Router } from 'express';
import { Role } from '@prisma/client';
import { getVehicles, getVehicleById, createVehicle, updateVehicle, deleteVehicle, setVehicleTestOnline } from '../controllers/agvController';
import { getTasks, getTaskById, createTask, assignTask, deleteTask, updateTask } from '../controllers/taskController';
import { getLogs } from '../controllers/logController';
import { login, getMe } from '../controllers/authController';
import { getSettings, updateSettings } from '../controllers/settingsController';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();

// 認証API（ログイン前に使うので、ここだけはトークン不要）
router.post('/login', login);

// ↓ これより下のAPIはすべてログイン必須
router.use(requireAuth);

router.get('/me', getMe);

// 車両API
router.get('/vehicles', getVehicles);
router.get('/vehicles/:id', getVehicleById);
router.post('/vehicles', requireRole(Role.ADMIN), createVehicle);
router.patch('/vehicles/:id', requireRole(Role.ADMIN), updateVehicle);
router.delete('/vehicles/:id', requireRole(Role.ADMIN), deleteVehicle);
router.post('/vehicles/:id/test-online', requireRole(Role.ADMIN), setVehicleTestOnline); // 【仮】テスト用

// タスクAPI
router.get('/tasks', getTasks);
router.post('/tasks', createTask);
router.post('/tasks/assign', assignTask);
router.get('/tasks/:id', getTaskById);
router.delete('/tasks/:id', deleteTask); // 未割当・割当済は取り消し、実行中は中止（CANCEL_TASK）
router.patch('/tasks/:id', updateTask);

// ログAPI
router.get('/logs', getLogs);

// 運行の設定API（読むのは全員、変えるのは ADMIN だけ）
router.get('/settings', getSettings);
router.put('/settings', requireRole(Role.ADMIN), updateSettings);

export default router;
