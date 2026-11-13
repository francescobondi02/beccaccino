CREATE TABLE "PracticeMatch" (
    "id" SERIAL NOT NULL,
    "humanSeat" INTEGER NOT NULL,
    "botTier" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeMatch_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Round"
ADD COLUMN "briscolaAutoChosen" BOOLEAN;

ALTER TABLE "PlayedCard"
ADD COLUMN "autoPlayed" BOOLEAN;
