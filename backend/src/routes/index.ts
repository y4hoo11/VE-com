// routes/index.ts
import { Router } from 'express';
import { getVehicles, getVehicleById } from '../controllers/agvController';
import { getTasks, createTask, assignTask, deleteTask, updateTask } from '../controllers/taskController'; // deleteTaskを追加
import { getLogs } from '../controllers/logController';
import { login, getMe } from '../controllers/authController';
import { requireAuth } from '../middleware/auth';

const router = Router();

// 認証API（ログイン前に使うので、ここだけはトークン不要）
router.post('/login', login);

// ↓ これより下のAPIはすべてログイン必須
router.use(requireAuth);

router.get('/me', getMe);

// 車両API
router.get('/vehicles', getVehicles);
router.get('/vehicles/:id', getVehicleById);

// タスクAPI
router.get('/tasks', getTasks);
router.post('/tasks', createTask);
router.post('/tasks/assign', assignTask);
router.delete('/tasks/:id', deleteTask); // 👈 削除APIを追加
router.patch('/tasks/:id', updateTask);

// ログAPI
router.get('/logs', getLogs);

export default router;
