/*
  Warnings:

  - You are about to drop the column `pauseEpoch` on the `GameRoom` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "GameRoom" DROP COLUMN "pauseEpoch",
ADD COLUMN     "turnStartedAt" TIMESTAMP(3);

-- Give games already in progress a turn start.
UPDATE "GameRoom" SET "turnStartedAt" = "lastActivityAt" WHERE "started" AND NOT "finished";
