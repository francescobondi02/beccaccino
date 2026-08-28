import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { Prisma, PrismaClient } from "@prisma/client";
import { parseAnnotationScenarioBatch } from "../annotations/batch";
import { canonicalJson } from "../annotations/state";

interface AnnotationBatchManifest {
  batchId: string;
  batchSha256: string;
}

export interface AnnotationImportSummary {
  batchId: string;
  catalogSha256: string;
  validated: number;
  wouldInsert: number;
  inserted: number;
  skipped: number;
  wouldActivate: number;
  activated: number;
  wouldDeactivate: number;
  deactivated: number;
  applied: boolean;
}

export interface AnnotationImportOptions {
  apply: boolean;
  replaceActive?: boolean;
  validatePlan?: (summary: AnnotationImportSummary) => void;
}

interface AnnotationCatalogRow {
  id: number;
  code: string;
  decisionType: string;
  predictedDifficulty: string;
  importance: number;
  tags: string[];
  state: Prisma.JsonValue;
  stateHash: string;
  sourceBatch: string;
  active: boolean;
}

function parseManifest(value: unknown): AnnotationBatchManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("annotation manifest must be an object");
  }
  const manifest = value as Record<string, unknown>;
  if (
    typeof manifest.batchId !== "string" ||
    !/^[a-z0-9][a-z0-9-]{2,79}$/.test(manifest.batchId)
  ) {
    throw new Error("annotation manifest batchId is invalid");
  }
  if (
    typeof manifest.batchSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifest.batchSha256)
  ) {
    throw new Error("annotation manifest batchSha256 is invalid");
  }
  return {
    batchId: manifest.batchId,
    batchSha256: manifest.batchSha256,
  };
}

export async function readAnnotationBatch(
  batchPath: string,
  manifestPath: string,
) {
  const [batchBytes, manifestText] = await Promise.all([
    readFile(batchPath),
    readFile(manifestPath, "utf8"),
  ]);
  const manifest = parseManifest(JSON.parse(manifestText));
  const batchSha256 = createHash("sha256").update(batchBytes).digest("hex");
  if (batchSha256 !== manifest.batchSha256) {
    throw new Error("annotation batch bytes do not match manifest batchSha256");
  }
  const scenarios = parseAnnotationScenarioBatch(
    JSON.parse(batchBytes.toString("utf8")),
  );
  return { manifest, scenarios };
}

export type LoadedAnnotationBatch = Awaited<
  ReturnType<typeof readAnnotationBatch>
>;

function sameScenario(
  existing: AnnotationCatalogRow,
  incoming: ReturnType<typeof parseAnnotationScenarioBatch>[number],
  batchId: string,
): boolean {
  return (
    existing.code === incoming.code &&
    existing.decisionType === incoming.decisionType &&
    existing.predictedDifficulty === incoming.predictedDifficulty &&
    existing.importance === incoming.importance &&
    canonicalJson(existing.tags) === canonicalJson(incoming.tags) &&
    canonicalJson(existing.state) === canonicalJson(incoming.state) &&
    existing.stateHash === incoming.stateHash &&
    existing.sourceBatch === batchId
  );
}

function annotationCatalogSha256(
  catalog: readonly AnnotationCatalogRow[],
): string {
  return createHash("sha256").update(canonicalJson(catalog)).digest("hex");
}

export async function importLoadedAnnotationBatch(
  batch: LoadedAnnotationBatch,
  options: AnnotationImportOptions,
  client?: PrismaClient,
): Promise<AnnotationImportSummary> {
  const prisma = client ?? new PrismaClient({ log: [] });
  const { manifest, scenarios } = batch;
  try {
    return await prisma.$transaction(
      async (tx) => {
        const catalog = await tx.annotationScenario.findMany({
          select: {
            id: true,
            code: true,
            decisionType: true,
            predictedDifficulty: true,
            importance: true,
            tags: true,
            state: true,
            stateHash: true,
            sourceBatch: true,
            active: true,
          },
          orderBy: { id: "asc" },
        });
        const incomingCodes = new Set(
          scenarios.map((scenario) => scenario.code),
        );
        const incomingHashes = new Set(
          scenarios.map((scenario) => scenario.stateHash),
        );
        const existing = catalog.filter(
          (scenario) =>
            incomingCodes.has(scenario.code) ||
            incomingHashes.has(scenario.stateHash),
        );
        const byCode = new Map(
          existing.map((scenario) => [scenario.code, scenario]),
        );
        const byHash = new Map(
          existing.map((scenario) => [scenario.stateHash, scenario]),
        );
        const pending = scenarios.filter((scenario) => {
          const codeMatch = byCode.get(scenario.code);
          const hashMatch = byHash.get(scenario.stateHash);
          if (!codeMatch && !hashMatch) return true;
          if (
            !codeMatch ||
            !hashMatch ||
            codeMatch.code !== hashMatch.code ||
            !sameScenario(codeMatch, scenario, manifest.batchId)
          ) {
            throw new Error(
              `annotation scenario identifier conflict for ${scenario.code}`,
            );
          }
          return false;
        });

        let wouldActivate = 0;
        let wouldDeactivate = 0;
        if (options.replaceActive) {
          wouldActivate = catalog.filter(
            (scenario) => !scenario.active && incomingCodes.has(scenario.code),
          ).length;
          wouldDeactivate = catalog.filter(
            (scenario) => scenario.active && !incomingCodes.has(scenario.code),
          ).length;
        }

        const plan: AnnotationImportSummary = {
          batchId: manifest.batchId,
          catalogSha256: annotationCatalogSha256(catalog),
          validated: scenarios.length,
          wouldInsert: pending.length,
          inserted: 0,
          skipped: scenarios.length - pending.length,
          wouldActivate,
          activated: 0,
          wouldDeactivate,
          deactivated: 0,
          applied: false,
        };
        if (!options.apply) return plan;

        options.validatePlan?.(plan);
        if (pending.length > 0) {
          await tx.annotationScenario.createMany({
            data: pending.map((scenario) => ({
              code: scenario.code,
              decisionType: scenario.decisionType,
              predictedDifficulty: scenario.predictedDifficulty,
              importance: scenario.importance,
              tags: [...scenario.tags],
              state: scenario.state as unknown as Prisma.InputJsonValue,
              stateHash: scenario.stateHash,
              sourceBatch: manifest.batchId,
            })),
          });
        }

        let activated = 0;
        let deactivated = 0;
        if (options.replaceActive) {
          const incomingCodeList = [...incomingCodes];
          const activatedResult = await tx.annotationScenario.updateMany({
            where: { code: { in: incomingCodeList }, active: false },
            data: { active: true },
          });
          activated = activatedResult.count;
          const deactivatedResult = await tx.annotationScenario.updateMany({
            where: {
              active: true,
              code: { notIn: incomingCodeList },
            },
            data: { active: false },
          });
          deactivated = deactivatedResult.count;
        }

        return {
          ...plan,
          inserted: pending.length,
          activated,
          deactivated,
          applied: true,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } finally {
    if (!client) {
      await prisma.$disconnect();
    }
  }
}

export async function importAnnotationBatch(
  batchPath: string,
  manifestPath: string,
  options: AnnotationImportOptions,
  client?: PrismaClient,
): Promise<AnnotationImportSummary> {
  const batch = await readAnnotationBatch(batchPath, manifestPath);
  return importLoadedAnnotationBatch(batch, options, client);
}
