import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  canonicalJson,
  parseAnnotationScenarioBatch,
} from "../annotations/scenario";

interface AnnotationBatchManifest {
  batchId: string;
  batchSha256: string;
}

export interface AnnotationImportSummary {
  batchId: string;
  validated: number;
  inserted: number;
  skipped: number;
  wouldDeactivate: number;
  deactivated: number;
  applied: boolean;
}

export interface AnnotationImportOptions {
  apply: boolean;
  replaceActive?: boolean;
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

function sameScenario(
  existing: {
    code: string;
    decisionType: string;
    predictedDifficulty: string;
    importance: number;
    tags: string[];
    state: Prisma.JsonValue;
    stateHash: string;
    sourceBatch: string;
  },
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

export async function importAnnotationBatch(
  batchPath: string,
  manifestPath: string,
  options: AnnotationImportOptions,
  client?: PrismaClient,
): Promise<AnnotationImportSummary> {
  const prisma = client ?? new PrismaClient({ log: [] });
  const { manifest, scenarios } = await readAnnotationBatch(
    batchPath,
    manifestPath,
  );
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.annotationScenario.findMany({
        where: {
          OR: [
            { code: { in: scenarios.map((scenario) => scenario.code) } },
            {
              stateHash: {
                in: scenarios.map((scenario) => scenario.stateHash),
              },
            },
          ],
        },
        select: {
          code: true,
          decisionType: true,
          predictedDifficulty: true,
          importance: true,
          tags: true,
          state: true,
          stateHash: true,
          sourceBatch: true,
        },
      });
      const byCode = new Map(existing.map((scenario) => [scenario.code, scenario]));
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

      if (options.apply && pending.length > 0) {
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
      let deactivated = 0;
      let wouldDeactivate = 0;
      if (options.replaceActive) {
        const incomingCodes = scenarios.map((scenario) => scenario.code);
        wouldDeactivate = await tx.annotationScenario.count({
          where: {
            active: true,
            code: { notIn: incomingCodes },
          },
        });
        if (options.apply) {
          await tx.annotationScenario.updateMany({
            where: { code: { in: incomingCodes }, active: false },
            data: { active: true },
          });
          const result = await tx.annotationScenario.updateMany({
            where: {
              active: true,
              code: { notIn: incomingCodes },
            },
            data: { active: false },
          });
          deactivated = result.count;
        }
      }
      return {
        batchId: manifest.batchId,
        validated: scenarios.length,
        inserted: options.apply ? pending.length : 0,
        skipped: scenarios.length - pending.length,
        wouldDeactivate,
        deactivated,
        applied: options.apply,
      };
    });
  } finally {
    if (!client) {
      await prisma.$disconnect();
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const replaceActive = args.includes("--replace-active");
  const paths = args.filter(
    (arg) => arg !== "--apply" && arg !== "--replace-active",
  );
  if (paths.length !== 2) {
    throw new Error(
      "Usage: importAnnotationScenarios <batch.json> <manifest.json> [--apply] [--replace-active]",
    );
  }
  const summary = await importAnnotationBatch(
    paths[0],
    paths[1],
    { apply, replaceActive },
  );
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Annotation import failed: ${message}\n`);
    process.exitCode = 1;
  });
}
