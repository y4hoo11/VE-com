// prisma/createUser.ts
// チームメンバーのアカウントを作成（または既存ユーザーのパスワードを変更）するスクリプト
//
// 使い方（ルートフォルダで実行）:
//   npm run user:create -w backend -- <ユーザー名> [ロール]
//   例) npm run user:create -w backend -- megi
//       npm run user:create -w backend -- megi ADMIN
// パスワードは実行後に入力を求められます（コマンド履歴に残さないため）
// ロール: ADMIN / OPERATOR / VIEWER（省略時は OPERATOR）

/// <reference types="node" />
import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import readline from 'readline';

const prisma = new PrismaClient();

const ask = (question: string): Promise<string> => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
};

async function main() {
  const [username, roleArg] = process.argv.slice(2);

  if (!username) {
    console.error('使い方: npm run user:create -w backend -- <ユーザー名> [ADMIN|OPERATOR|VIEWER]');
    process.exit(1);
  }

  const role = (roleArg?.toUpperCase() || Role.OPERATOR) as Role;
  if (!Object.values(Role).includes(role)) {
    console.error(`不正なロールです: ${roleArg}（ADMIN / OPERATOR / VIEWER のいずれか）`);
    process.exit(1);
  }

  const password = await ask(`${username} のパスワード（8文字以上）: `);
  if (password.length < 8) {
    console.error('パスワードは8文字以上にしてください');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await prisma.user.findUnique({ where: { username } });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, ...(roleArg ? { role } : {}) },
    });
    console.log(`✅ ${username} のパスワードを更新しました（ロール: ${roleArg ? role : existing.role}）`);
  } else {
    await prisma.user.create({
      data: {
        username,
        email: `${username}@ve-con.local`, // メールは現状ログインに使わないため仮の値
        passwordHash,
        role,
      },
    });
    console.log(`✅ ${username} を作成しました（ロール: ${role}）`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
