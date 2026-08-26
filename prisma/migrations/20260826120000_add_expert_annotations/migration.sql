ALTER TABLE "User"
ADD COLUMN "expertAccessGrantedAt" TIMESTAMP(3);

CREATE TABLE "AnnotationScenario" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "predictedDifficulty" TEXT NOT NULL,
    "importance" INTEGER NOT NULL,
    "tags" TEXT[],
    "state" JSONB NOT NULL,
    "stateHash" TEXT NOT NULL,
    "sourceBatch" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnotationScenario_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExpertAnnotation" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "scenarioId" INTEGER NOT NULL,
    "scenarioHash" TEXT NOT NULL,
    "selectedSuit" "Suit",
    "selectedValue" "Value",
    "selectedSignal" TEXT,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "perceivedDifficulty" TEXT NOT NULL,
    "responseTimeMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpertAnnotation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnnotationScenario_code_key"
ON "AnnotationScenario"("code");

CREATE UNIQUE INDEX "AnnotationScenario_stateHash_key"
ON "AnnotationScenario"("stateHash");

CREATE INDEX "AnnotationScenario_active_predictedDifficulty_idx"
ON "AnnotationScenario"("active", "predictedDifficulty");

CREATE UNIQUE INDEX "ExpertAnnotation_userId_scenarioId_key"
ON "ExpertAnnotation"("userId", "scenarioId");

CREATE INDEX "ExpertAnnotation_scenarioId_idx"
ON "ExpertAnnotation"("scenarioId");

ALTER TABLE "ExpertAnnotation"
ADD CONSTRAINT "ExpertAnnotation_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExpertAnnotation"
ADD CONSTRAINT "ExpertAnnotation_scenarioId_fkey"
FOREIGN KEY ("scenarioId") REFERENCES "AnnotationScenario"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
