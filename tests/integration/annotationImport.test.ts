import { createHash } from "crypto";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "../../src/db";
import { annotationStateHash } from "../../src/annotations/scenario";
import { importAnnotationBatch } from "../../src/scripts/importAnnotationScenarios";
import {
  annotationScenarioCreateData,
  annotationScenarioInput,
  annotationScenarioState,
  chooseBriscolaScenarioInput,
} from "../helpers/annotationScenario";
import { clearDatabase } from "../helpers/gameHelpers";

let temporaryDirectory: string;

beforeEach(async () => {
  await clearDatabase();
  temporaryDirectory = await mkdtemp(join(tmpdir(), "becca-annotation-import-"));
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

async function writeBatch(scenarios: unknown[]) {
  const batchPath = join(temporaryDirectory, "batch.json");
  const manifestPath = join(temporaryDirectory, "manifest.json");
  const batch = `${JSON.stringify(scenarios, null, 2)}\n`;
  await writeFile(batchPath, batch);
  await writeFile(
    manifestPath,
    `${JSON.stringify({
      batchId: "initial-v1",
      batchSha256: createHash("sha256").update(batch).digest("hex"),
    })}\n`,
  );
  return { batchPath, manifestPath };
}

describe("annotation scenario import", () => {
  it("validates in dry-run mode and applies an identical batch idempotently", async () => {
    const paths = await writeBatch([annotationScenarioInput()]);

    const dryRun = await importAnnotationBatch(
      paths.batchPath,
      paths.manifestPath,
      { apply: false },
      prisma,
    );
    expect(dryRun).toMatchObject({
      validated: 1,
      inserted: 0,
      skipped: 0,
      applied: false,
    });
    expect(await prisma.annotationScenario.count()).toBe(0);

    const applied = await importAnnotationBatch(
      paths.batchPath,
      paths.manifestPath,
      { apply: true },
      prisma,
    );
    const repeated = await importAnnotationBatch(
      paths.batchPath,
      paths.manifestPath,
      { apply: true },
      prisma,
    );
    expect(applied.inserted).toBe(1);
    expect(repeated).toMatchObject({ inserted: 0, skipped: 1 });
    expect(
      await prisma.annotationScenario.findFirstOrThrow({
        select: { decisionType: true },
      }),
    ).toEqual({ decisionType: "play_card" });
  });

  it("fails on identifier conflicts without partially writing the batch", async () => {
    const original = annotationScenarioInput();
    const originalPaths = await writeBatch([original]);
    await importAnnotationBatch(
      originalPaths.batchPath,
      originalPaths.manifestPath,
      { apply: true },
      prisma,
    );

    const conflict = {
      ...original,
      predictedDifficulty: "hard",
    };
    const newState = annotationScenarioState({
      totalScores: { 0: 3, 1: 0 },
    });
    const paths = await writeBatch([
      annotationScenarioInput({
        code: "initial-v1-0002",
        state: newState,
        stateHash: annotationStateHash(newState),
      }),
      conflict,
    ]);

    await expect(
      importAnnotationBatch(
        paths.batchPath,
        paths.manifestPath,
        { apply: true },
        prisma,
      ),
    ).rejects.toThrow(/identifier conflict/);
    expect(await prisma.annotationScenario.count()).toBe(1);
  });

  it("rejects a tampered batch before opening a write transaction", async () => {
    const scenario = annotationScenarioInput();
    const paths = await writeBatch([
      scenario,
      {
        ...scenario,
        code: "initial-v1-0002",
        stateHash: "0".repeat(64),
        state: { ...scenario.state, hiddenHands: [] },
      },
    ]);

    await expect(
      importAnnotationBatch(
        paths.batchPath,
        paths.manifestPath,
        { apply: true },
        prisma,
      ),
    ).rejects.toThrow(/must contain only/);
    expect(await prisma.annotationScenario.count()).toBe(0);
  });

  it("replaces the active catalog transactionally without deleting responses", async () => {
    const oldScenario = await prisma.annotationScenario.create({
      data: annotationScenarioCreateData({ code: "initial-v1-old" }),
    });
    const user = await prisma.user.create({ data: { username: "annotator" } });
    await prisma.expertAnnotation.create({
      data: {
        userId: user.id,
        scenarioId: oldScenario.id,
        scenarioHash: oldScenario.stateHash,
        skipped: true,
        perceivedDifficulty: "medium",
        responseTimeMs: 1000,
      },
    });
    const incoming = chooseBriscolaScenarioInput();
    const paths = await writeBatch([incoming]);

    const dryRun = await importAnnotationBatch(
      paths.batchPath,
      paths.manifestPath,
      { apply: false, replaceActive: true },
      prisma,
    );
    expect(dryRun).toMatchObject({
      wouldDeactivate: 1,
      deactivated: 0,
    });
    expect(
      await prisma.annotationScenario.findUniqueOrThrow({
        where: { id: oldScenario.id },
        select: { active: true },
      }),
    ).toEqual({ active: true });
    expect(await prisma.annotationScenario.count()).toBe(1);

    const summary = await importAnnotationBatch(
      paths.batchPath,
      paths.manifestPath,
      { apply: true, replaceActive: true },
      prisma,
    );

    expect(summary).toMatchObject({
      inserted: 1,
      wouldDeactivate: 1,
      deactivated: 1,
    });
    expect(
      await prisma.annotationScenario.findUniqueOrThrow({
        where: { id: oldScenario.id },
        select: { active: true },
      }),
    ).toEqual({ active: false });
    expect(
      await prisma.annotationScenario.findUniqueOrThrow({
        where: { code: incoming.code },
        select: { active: true, decisionType: true },
      }),
    ).toEqual({ active: true, decisionType: "choose_briscola" });
    expect(await prisma.expertAnnotation.count()).toBe(1);
  });
});
