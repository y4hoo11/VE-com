-- 車両のカメラ映像の URL（Pi カメラ・USB カメラ）。どちらも空欄可で、既存の行は空欄のまま
-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN "camera_url" TEXT,
ADD COLUMN "camera2_url" TEXT;
