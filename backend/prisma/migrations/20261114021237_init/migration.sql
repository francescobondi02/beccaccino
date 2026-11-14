-- CreateEnum
CREATE TYPE "Suit" AS ENUM ('denara', 'coppe', 'spade', 'bastoni');

-- CreateEnum
CREATE TYPE "Value" AS ENUM ('asso', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'fante', 'cavallo', 're');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "password" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "googleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" SERIAL NOT NULL,
    "seat" INTEGER,
    "isReady" BOOLEAN NOT NULL DEFAULT false,
    "team" INTEGER,
    "botModel" TEXT,
    "timeoutCount" INTEGER NOT NULL DEFAULT 0,
    "abandonedAt" TIMESTAMP(3),
    "userId" INTEGER NOT NULL,
    "gameRoomId" INTEGER NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameRoom" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "started" BOOLEAN NOT NULL DEFAULT false,
    "finished" BOOLEAN NOT NULL DEFAULT false,
    "winnerTeam" INTEGER,
    "isPractice" BOOLEAN NOT NULL DEFAULT false,
    "botTier" TEXT,
    "pausedAt" TIMESTAMP(3),
    "pauseEpoch" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Round" (
    "id" SERIAL NOT NULL,
    "number" INTEGER NOT NULL,
    "callerId" INTEGER NOT NULL,
    "briscola" "Suit",
    "briscolaAutoChosen" BOOLEAN NOT NULL DEFAULT false,
    "cricca" BOOLEAN NOT NULL DEFAULT false,
    "gameRoomId" INTEGER NOT NULL,
    "winnerTeam" INTEGER,
    "team0Raw" INTEGER NOT NULL DEFAULT 0,
    "team1Raw" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Round_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trick" (
    "id" SERIAL NOT NULL,
    "number" INTEGER NOT NULL,
    "roundId" INTEGER NOT NULL,
    "starterId" INTEGER NOT NULL,
    "winnerId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Trick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayedCard" (
    "id" SERIAL NOT NULL,
    "trickId" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "suit" "Suit" NOT NULL,
    "value" "Value" NOT NULL,
    "position" INTEGER NOT NULL,
    "signal" TEXT,
    "autoPlayed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PlayedCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandCard" (
    "id" SERIAL NOT NULL,
    "playerId" INTEGER NOT NULL,
    "roundId" INTEGER NOT NULL,
    "suit" "Suit" NOT NULL,
    "value" "Value" NOT NULL,

    CONSTRAINT "HandCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE INDEX "Player_userId_idx" ON "Player"("userId");

-- CreateIndex
CREATE INDEX "Player_gameRoomId_idx" ON "Player"("gameRoomId");

-- CreateIndex
CREATE UNIQUE INDEX "Player_gameRoomId_seat_key" ON "Player"("gameRoomId", "seat");

-- CreateIndex
CREATE UNIQUE INDEX "Player_gameRoomId_userId_key" ON "Player"("gameRoomId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "GameRoom_code_key" ON "GameRoom"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Round_gameRoomId_number_key" ON "Round"("gameRoomId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Trick_roundId_number_key" ON "Trick"("roundId", "number");

-- CreateIndex
CREATE INDEX "PlayedCard_playerId_idx" ON "PlayedCard"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayedCard_trickId_position_key" ON "PlayedCard"("trickId", "position");

-- CreateIndex
CREATE INDEX "HandCard_playerId_idx" ON "HandCard"("playerId");

-- CreateIndex
CREATE INDEX "HandCard_roundId_idx" ON "HandCard"("roundId");

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_gameRoomId_fkey" FOREIGN KEY ("gameRoomId") REFERENCES "GameRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Round" ADD CONSTRAINT "Round_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Round" ADD CONSTRAINT "Round_gameRoomId_fkey" FOREIGN KEY ("gameRoomId") REFERENCES "GameRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trick" ADD CONSTRAINT "Trick_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trick" ADD CONSTRAINT "Trick_starterId_fkey" FOREIGN KEY ("starterId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trick" ADD CONSTRAINT "Trick_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayedCard" ADD CONSTRAINT "PlayedCard_trickId_fkey" FOREIGN KEY ("trickId") REFERENCES "Trick"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayedCard" ADD CONSTRAINT "PlayedCard_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandCard" ADD CONSTRAINT "HandCard_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandCard" ADD CONSTRAINT "HandCard_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
