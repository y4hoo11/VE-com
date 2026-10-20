// routes/index.ts
import { Router } from 'express';
import { getVehicles, getVehicleById } from '../controllers/agvController';
import { getTasks, createTask, assignTask, deleteTask } from '../controllers/taskController'; // deleteTaskを追加

const router = Router();

// 車両API
router.get('/vehicles', getVehicles);
router.get('/vehicles/:id', getVehicleById);

// タスクAPI
router.get('/tasks', getTasks);
router.post('/tasks', createTask);
router.post('/tasks/assign', assignTask);
router.delete('/tasks/:id', deleteTask); // 👈 削除APIを追加

export default router;