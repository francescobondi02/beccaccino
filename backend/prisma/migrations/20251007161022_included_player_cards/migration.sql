-- CreateTable
CREATE TABLE "PlayerCard" (
    "id" SERIAL NOT NULL,
    "playerId" INTEGER NOT NULL,
    "roundId" INTEGER NOT NULL,
    "suit" "Suit" NOT NULL,
    "value" "Value" NOT NULL,
    "inHand" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PlayerCard_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PlayerCard" ADD CONSTRAINT "PlayerCard_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerCard" ADD CONSTRAINT "PlayerCard_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
