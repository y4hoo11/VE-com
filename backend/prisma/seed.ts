// prisma/seed.ts

/// <reference types="node" />
import { PrismaClient, VehicleStatus, TaskStatus, Role } from '@prisma/client';

const prisma = new PrismaClient();

// taskStorage.ts のダミーデータをベースにした初期データ
const DEFAULT_TASKS = [
  {
    id: '1',
    title: '搬送タスク (A13-2)',
    status: TaskStatus.PENDING,
    priority: 1,
    startLocation: 'A13',
    targetLocation: '2',
  },
];

async function main() {
  console.log('🌱 テストデータの投入を開始します...');

  // 1. テストユーザーの作成
  const user = await prisma.user.upsert({
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

  // 2. テスト車両 (AGV) の作成
  const vehicle = await prisma.vehicle.upsert({
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
    },
  });

  // 3. ダミーデータを元にしたタスクの作成
  for (const t of DEFAULT_TASKS) {
    await prisma.task.upsert({
      where: { id: t.id },
      update: {},
      create: {
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        startLocation: t.startLocation,
        targetLocation: t.targetLocation,
        createdByUserId: user.id,
      },
    });
  }

  console.log('✅ テストデータの投入が完了しました！');
  console.log({ user: user.username, vehicle: vehicle.id, tasksCount: DEFAULT_TASKS.length });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });