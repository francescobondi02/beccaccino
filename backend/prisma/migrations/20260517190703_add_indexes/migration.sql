-- CreateIndex
CREATE INDEX "Hand_roundId_idx" ON "Hand"("roundId");

-- CreateIndex
CREATE INDEX "PlayedCard_handId_idx" ON "PlayedCard"("handId");

-- CreateIndex
CREATE INDEX "PlayedCard_playerId_idx" ON "PlayedCard"("playerId");

-- CreateIndex
CREATE INDEX "Player_userId_idx" ON "Player"("userId");

-- CreateIndex
CREATE INDEX "Player_gameRoomId_idx" ON "Player"("gameRoomId");

-- CreateIndex
CREATE INDEX "PlayerCard_playerId_idx" ON "PlayerCard"("playerId");

-- CreateIndex
CREATE INDEX "PlayerCard_roundId_idx" ON "PlayerCard"("roundId");

-- CreateIndex
CREATE INDEX "Round_gameRoomId_idx" ON "Round"("gameRoomId");
