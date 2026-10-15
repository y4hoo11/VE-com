// backend/prisma/dump.ts DBの内容をコンソールに出力するためのスクリプト
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany();
  const vehicles = await prisma.vehicle.findMany();
  const tasks = await prisma.task.findMany();
  
  console.log('--- USERS ---', users);
  console.log('--- VEHICLES ---', vehicles);
  console.log('--- TASKS ---', tasks);
}

main().finally(() => prisma.$disconnect());