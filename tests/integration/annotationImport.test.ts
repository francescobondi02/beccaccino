import { createHash } from "crypto";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "../../src/db";
import { annotationStateHash } from "../../src/annotations/scenario";
import { importAnnotationBatch } from "../../src/scripts/importAnnotationScenarios";
import {
  annotationScenarioInput,
  annotationScenarioState,
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
      false,
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
      true,
      prisma,
    );
    const repeated = await importAnnotationBatch(
      paths.batchPath,
      paths.manifestPath,
      true,
      prisma,
    );
    expect(applied.inserted).toBe(1);
    expect(repeated).toMatchObject({ inserted: 0, skipped: 1 });
    expect(await prisma.annotationScenario.count()).toBe(1);
  });

  it("fails on identifier conflicts without partially writing the batch", async () => {
    const original = annotationScenarioInput();
    const originalPaths = await writeBatch([original]);
    await importAnnotationBatch(
      originalPaths.batchPath,
      originalPaths.manifestPath,
      true,
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
        true,
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
        true,
        prisma,
      ),
    ).rejects.toThrow(/must contain only/);
    expect(await prisma.annotationScenario.count()).toBe(0);
  });
});
