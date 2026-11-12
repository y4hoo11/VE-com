-- 以前から DB にあり、マイグレーション履歴に無かった一意制約（schema.prisma の username @unique）。
-- 既にある DB では何もしない
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "users"("username");

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'APPLIED');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('APPROVE', 'REJECT');

-- CreateTable
CREATE TABLE "setting_change_requests" (
    "id" TEXT NOT NULL,
    "setting_key" TEXT NOT NULL,
    "setting_label" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "current_value" TEXT NOT NULL,
    "requested_value" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "effect" TEXT,
    "safety_rule" TEXT,
    "pledged_at" TIMESTAMP(3),
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "direct" BOOLEAN NOT NULL DEFAULT false,
    "requested_by_user_id" TEXT,
    "requested_by_name" TEXT NOT NULL,
    "applied_value" TEXT,
    "applied_by_name" TEXT,
    "signature" TEXT,
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "setting_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setting_change_reviews" (
    "id" BIGSERIAL NOT NULL,
    "request_id" TEXT NOT NULL,
    "user_id" TEXT,
    "reviewer_name" TEXT NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "setting_change_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "setting_change_requests_status_idx" ON "setting_change_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "setting_change_reviews_request_id_user_id_key" ON "setting_change_reviews"("request_id", "user_id");

-- AddForeignKey
ALTER TABLE "setting_change_requests" ADD CONSTRAINT "setting_change_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setting_change_reviews" ADD CONSTRAINT "setting_change_reviews_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "setting_change_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setting_change_reviews" ADD CONSTRAINT "setting_change_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

