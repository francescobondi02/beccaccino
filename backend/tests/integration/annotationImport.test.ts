import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "../../src/db";
import { importAnnotationBatch } from "../../src/scripts/importAnnotationScenarios";
import {
  annotationScenarioCreateData,
  chooseBriscolaScenarioInput,
} from "../helpers/annotationScenario";
import { writeAnnotationBatchFiles } from "../helpers/annotationBatch";
import { clearDatabase } from "../helpers/database";

let temporaryDirectory: string;

beforeEach(async () => {
  await clearDatabase();
  temporaryDirectory = await mkdtemp(
    join(tmpdir(), "becca-annotation-import-"),
  );
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

async function writeBatch(scenarios: unknown[]) {
  return writeAnnotationBatchFiles(
    temporaryDirectory,
    scenarios as ReturnType<typeof chooseBriscolaScenarioInput>[],
    "initial-v1",
  );
}

describe("annotation scenario import", () => {
  it("validates in dry-run mode and applies an identical batch idempotently", async () => {
    const paths = await writeBatch([
      chooseBriscolaScenarioInput({ code: "initial-v1-00001" }),
    ]);

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
    ).toEqual({ decisionType: "choose_briscola" });
  });

  it("fails on identifier conflicts without partially writing the batch", async () => {
    const original = chooseBriscolaScenarioInput({
      code: "initial-v1-00001",
    });
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
    const paths = await writeBatch([conflict]);

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
    const scenario = chooseBriscolaScenarioInput({
      code: "initial-v1-00001",
    });
    const paths = await writeBatch([
      {
        ...scenario,
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

  it("validates the confirmed plan before writing", async () => {
    const paths = await writeBatch([
      chooseBriscolaScenarioInput({ code: "initial-v1-00001" }),
    ]);

    await expect(
      importAnnotationBatch(
        paths.batchPath,
        paths.manifestPath,
        {
          apply: true,
          validatePlan: () => {
            throw new Error("plan changed");
          },
        },
        prisma,
      ),
    ).rejects.toThrow(/plan changed/);
    expect(await prisma.annotationScenario.count()).toBe(0);
  });

  it("fingerprints exact catalog changes even when plan counts stay equal", async () => {
    const existing = await prisma.annotationScenario.create({
      data: annotationScenarioCreateData({ code: "initial-v1-old" }),
    });
    const paths = await writeBatch([
      chooseBriscolaScenarioInput({ code: "initial-v1-00001" }),
    ]);

    const first = await importAnnotationBatch(
      paths.batchPath,
      paths.manifestPath,
      { apply: false, replaceActive: true },
      prisma,
    );
    await prisma.annotationScenario.update({
      where: { id: existing.id },
      data: { importance: 3 },
    });
    const second = await importAnnotationBatch(
      paths.batchPath,
      paths.manifestPath,
      { apply: false, replaceActive: true },
      prisma,
    );

    expect(first.wouldInsert).toBe(second.wouldInsert);
    expect(first.wouldDeactivate).toBe(second.wouldDeactivate);
    expect(first.catalogSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(second.catalogSha256).not.toBe(first.catalogSha256);
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
    const incoming = chooseBriscolaScenarioInput({
      code: "initial-v1-00001",
    });
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
