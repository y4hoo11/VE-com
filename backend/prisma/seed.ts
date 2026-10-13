// prisma/seed.ts

/// <reference types="node" />
import { PrismaClient, VehicleStatus, TaskStatus, Role } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 データベースの初期化とテストデータの投入を開始します...');

  // 1. ユーザーの作成
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      id: 'usr-001',
      username: 'admin',
      email: 'admin@example.com',
      passwordHash: 'hashed_password',
      role: Role.ADMIN,
    },
  });

  // 2. 車両 (AGV) の作成
  const vehicleAlpha = await prisma.vehicle.upsert({
    where: { id: 'AGV-01' },
    update: {},
    create: {
      id: 'AGV-01',
      name: 'AGV Alpha',
      status: VehicleStatus.IDLE,
      batteryLevel: 90,
      currentX: 0.0,
      currentY: 0.0,
      currentTheta: 0.0,
      currentMapId: 'map-01',
    },
  });

  // 3. タスクの作成
  const taskA = await prisma.task.upsert({
    where: { id: 'task-001' },
    update: {},
    create: {
      id: 'task-001',
      title: '搬送タスク (A13-2)',
      status: TaskStatus.PENDING,
      priority: 1,
      startLocation: 'A13',
      targetLocation: '2',
      createdByUserId: adminUser.id,
    },
  });

  // 4. 車両ログの作成 (vehicle_logs)
  await prisma.vehicleLog.create({
    data: {
      vehicleId: vehicleAlpha.id,
      logLevel: 'INFO',
      message: 'AGVシステムが起動しました',
      details: { code: 'INIT_SUCCESS', sensorStatus: 'OK' },
    },
  });

  // 5. タスク履歴の作成 (task_histories)
  await prisma.taskHistory.create({
    data: {
      taskId: taskA.id,
      status: 'PENDING',
      note: 'タスクが新規作成されました',
    },
  });

  // 6. システム設定の作成 (system_settings)
  await prisma.systemSetting.upsert({
    where: { key: 'mqtt.broker_url' },
    update: {},
    create: {
      key: 'mqtt.broker_url',
      value: 'mqtt://localhost:1883',
      category: 'SYSTEM',
      description: 'MQTTブローカーの接続先URL',
      updatedByUserId: adminUser.id,
    },
  });

  console.log('✅ すべてのテストデータの投入が完了しました！');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });