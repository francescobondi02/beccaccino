/*
  Warnings:

  - A unique constraint covering the columns `[roundId,number]` on the table `Hand` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[handId,position]` on the table `PlayedCard` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[gameRoomId,number]` on the table `Round` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."Hand_roundId_idx";

-- DropIndex
DROP INDEX "public"."PlayedCard_handId_idx";

-- DropIndex
DROP INDEX "public"."Round_gameRoomId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Hand_roundId_number_key" ON "Hand"("roundId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PlayedCard_handId_position_key" ON "PlayedCard"("handId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Round_gameRoomId_number_key" ON "Round"("gameRoomId", "number");
