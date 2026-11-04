// app.ts
import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import routes from './routes';
import { socketService } from './services/socketService';
import { mqttService } from './services/mqttService';

const app = express();
const httpServer = createServer(app);
const prisma = new PrismaClient();

// ミドルウェア
app.use(cors());
app.use(express.json());

// ルートパス
app.get('/', (req, res) => {
  res.send('AGV Dispatch Server is running!');
});

// ヘルスチェックエンドポイント (DB疎通確認)
app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected', mqtt: mqttService.isConnected() ? 'connected' : 'disconnected' });
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'disconnected', error });
  }
});

// APIルーティングの登録 (/api/...)
app.use('/api', routes);

// 通信サービスの初期化
socketService.init(httpServer);
mqttService.init();

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`=================================`);
  console.log(` 配車サーバが起動しました`);
  console.log(` URL: http://localhost:${PORT}`);
  console.log(` API: http://localhost:${PORT}/api`);
  console.log(`=================================`);
});