-- タスクごとの「自動割り当ての対象にするか」。既存の行は対象（true）にする
-- AlterTable
ALTER TABLE "tasks" ADD COLUMN "auto_assign" BOOLEAN NOT NULL DEFAULT true;
