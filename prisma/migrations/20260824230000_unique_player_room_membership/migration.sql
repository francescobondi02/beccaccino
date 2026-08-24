-- A user can hold at most one player seat in a room.
CREATE UNIQUE INDEX "Player_gameRoomId_userId_key"
ON "Player"("gameRoomId", "userId");
