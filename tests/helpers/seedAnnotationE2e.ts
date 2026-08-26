import dotenv from "dotenv";
import { Prisma, PrismaClient } from "@prisma/client";
import { annotationStateHash } from "../../src/annotations/scenario";
import {
  annotationScenarioCreateData,
  annotationScenarioState,
} from "./annotationScenario";

dotenv.config();

async function main() {
  const prisma = new PrismaClient({ log: [] });
  const secondState = annotationScenarioState({
    totalScores: { 0: 3, 1: 0 },
  });
  try {
    await prisma.annotationScenario.createMany({
      data: [
        {
          ...annotationScenarioCreateData({
            code: "e2e-annotation-medium",
          }),
          sourceBatch: "e2e",
        },
        {
          ...annotationScenarioCreateData({
            code: "e2e-annotation-hard",
            predictedDifficulty: "hard",
            state: secondState,
            stateHash: annotationStateHash(secondState),
          }),
          state: secondState as unknown as Prisma.InputJsonValue,
          sourceBatch: "e2e",
        },
      ],
      skipDuplicates: true,
    });
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Failed to seed annotation E2E scenarios: ${
      error instanceof Error ? error.message : String(error)
    }\n`,
  );
  process.exitCode = 1;
});
