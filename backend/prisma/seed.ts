// prisma/seed.ts

/// <reference types="node" />
import { PrismaClient, VehicleStatus, TaskStatus, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// AGV-01 のカメラ映像（ラズパイ agv-pi の配信）
const AGV01_CAMERA = 'http://agv-pi.local:8090/stream.mjpg'; // Pi カメラ
const AGV01_CAMERA2 = 'http://agv-pi.local:8091/'; // USB カメラ

async function main() {
  console.log('🌱 データベースの初期化とテストデータの投入を開始します...');

  // 1. ユーザーの作成
  // 開発用の管理者パスワード（.env の SEED_ADMIN_PASSWORD があればそれを使う）
  const adminPasswordHash = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || 'admin123', 10);

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      id: 'usr-001',
      username: 'admin',
      email: 'admin@example.com',
      passwordHash: adminPasswordHash,
      role: Role.ADMIN,
    },
  });

  // 以前の仮パスワード（'hashed_password'）のままなら、本物のハッシュに置き換える
  if (adminUser.passwordHash === 'hashed_password') {
    await prisma.user.update({
      where: { id: adminUser.id },
      data: { passwordHash: adminPasswordHash },
    });
  }

  // 2. 車両 (AGV) の作成
  const vehicleAlpha = await prisma.vehicle.upsert({
    where: { id: 'AGV-01' },
    // カメラは実機（agv-pi）の配信先。すでにある DB にも入るよう、update でも入れる
    update: { cameraUrl: AGV01_CAMERA, camera2Url: AGV01_CAMERA2 },
    create: {
      id: 'AGV-01',
      name: 'AGV Alpha',
      cameraUrl: AGV01_CAMERA,
      camera2Url: AGV01_CAMERA2,
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