import { prisma } from "../../src/db";
import { annotationDatabaseStatus } from "../../src/scripts/annotationDatabase";
import {
  annotationScenarioCreateData,
  chooseBriscolaScenarioCreateData,
} from "../helpers/annotationScenario";
import { clearDatabase } from "../helpers/gameHelpers";

beforeEach(async () => {
  await clearDatabase();
});

describe("annotation database status", () => {
  it("summarizes active and historical catalogs with response totals", async () => {
    const historical = await prisma.annotationScenario.create({
      data: {
        ...annotationScenarioCreateData(),
        active: false,
      },
    });
    await prisma.annotationScenario.create({
      data: chooseBriscolaScenarioCreateData(),
    });
    const user = await prisma.user.create({
      data: { username: "status-annotator" },
    });
    await prisma.expertAnnotation.create({
      data: {
        userId: user.id,
        scenarioId: historical.id,
        scenarioHash: historical.stateHash,
        skipped: true,
        perceivedDifficulty: "medium",
        responseTimeMs: 1000,
      },
    });

    await expect(annotationDatabaseStatus(prisma)).resolves.toEqual({
      scenarioCount: 2,
      activeScenarioCount: 1,
      responseCount: 1,
      catalogs: [
        {
          sourceBatch: "annotator-v2",
          decisionType: "choose_briscola",
          predictedDifficulty: "medium",
          active: true,
          count: 1,
        },
        {
          sourceBatch: "initial-v1",
          decisionType: "play_card",
          predictedDifficulty: "medium",
          active: false,
          count: 1,
        },
      ],
    });
  });
});
