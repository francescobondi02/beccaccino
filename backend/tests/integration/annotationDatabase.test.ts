import { prisma } from "../../src/db";
import { annotationDatabaseStatus } from "../../src/scripts/annotationDatabaseStatus";
import { annotationRestorePlanToken } from "../../src/scripts/annotationDatabase";
import { restoreActiveAnnotationBatch } from "../../src/scripts/importAnnotationScenarios";
import {
  annotationScenarioCreateData,
  chooseBriscolaScenarioCreateData,
} from "../helpers/annotationScenario";
import { clearDatabase } from "../helpers/database";

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

describe("annotation database restore", () => {
  it("dry-runs and restores a retained source batch without deleting responses", async () => {
    const historical = await prisma.annotationScenario.create({
      data: {
        ...annotationScenarioCreateData({ code: "expert-v1-00001" }),
        sourceBatch: "expert-v1",
        active: false,
      },
    });
    await prisma.annotationScenario.create({
      data: {
        ...chooseBriscolaScenarioCreateData({ code: "expert-v2-00001" }),
        sourceBatch: "expert-v2",
        active: true,
      },
    });
    const user = await prisma.user.create({
      data: { username: "restore-annotator" },
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

    const dryRun = await restoreActiveAnnotationBatch(
      "expert-v1",
      { apply: false },
      prisma,
    );
    const tokenInput = {
      targets: {
        pooled: { host: "localhost", port: "5432", database: "becca_test" },
        direct: { host: "localhost", port: "5432", database: "becca_test" },
      },
      connectionSha256: "a".repeat(64),
      toolSha256: "b".repeat(64),
    };
    const planToken = annotationRestorePlanToken({
      ...tokenInput,
      summary: dryRun,
    });

    expect(dryRun).toMatchObject({
      retained: 1,
      wouldActivate: 1,
      activated: 0,
      wouldDeactivate: 1,
      deactivated: 0,
      applied: false,
    });
    expect(
      await prisma.annotationScenario.findMany({
        orderBy: { sourceBatch: "asc" },
        select: { sourceBatch: true, active: true },
      }),
    ).toEqual([
      { sourceBatch: "expert-v1", active: false },
      { sourceBatch: "expert-v2", active: true },
    ]);

    const applied = await restoreActiveAnnotationBatch(
      "expert-v1",
      {
        apply: true,
        validatePlan: (plan) => {
          expect(
            annotationRestorePlanToken({ ...tokenInput, summary: plan }),
          ).toBe(planToken);
        },
      },
      prisma,
    );

    expect(applied).toMatchObject({
      activated: 1,
      deactivated: 1,
      applied: true,
    });
    expect(
      await prisma.annotationScenario.findMany({
        orderBy: { sourceBatch: "asc" },
        select: { sourceBatch: true, active: true },
      }),
    ).toEqual([
      { sourceBatch: "expert-v1", active: true },
      { sourceBatch: "expert-v2", active: false },
    ]);
    expect(await prisma.annotationScenario.count()).toBe(2);
    expect(await prisma.expertAnnotation.count()).toBe(1);
  });
});
