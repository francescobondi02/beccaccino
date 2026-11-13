-- AlterTable
ALTER TABLE "GameRoom" ADD COLUMN     "isPractice" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "botModel" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isBot" BOOLEAN NOT NULL DEFAULT false;

