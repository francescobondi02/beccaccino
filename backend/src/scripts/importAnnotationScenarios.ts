import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { Prisma, PrismaClient } from "@prisma/client";
import { parseAnnotationScenarioBatch } from "../annotations/batch";
import {
  ANNOTATION_DIFFICULTIES,
  ANNOTATION_IMPORTANCE,
} from "../annotations/constants";
import { AnnotationScenarioInput } from "../annotations/contracts";
import { nonEmptyStringAt } from "../annotations/parsing";
import { exactKeys, integerAt, recordAt } from "../utils/json";
import { canonicalJson } from "../annotations/state";

const ANNOTATION_FAMILIES = [
  "borderline_briscola",
  "lead",
  "risk",
] as const;
const RULES_VERSION = "becca-annotation-rules-v2";
const METHOD_VERSION = "offline-full-pool-public-impact-diversity-v2";
const MAX_SCENARIOS_PER_SOURCE_GAME = 2;
const DIVERSITY_PENALTY = 0.12;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const BATCH_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,72}$/;

type AnnotationFamily = (typeof ANNOTATION_FAMILIES)[number];

export interface AnnotationBatchManifest {
  readonly batchId: string;
  readonly seedFingerprint: string;
  readonly generatorCommit: string;
  readonly modelSha256: string;
  readonly rulesVersion: typeof RULES_VERSION;
  readonly methodVersion: typeof METHOD_VERSION;
  readonly parameters: {
    readonly scenarioCount: number;
    readonly familyQuotas: Readonly<Record<AnnotationFamily, number>>;
    readonly sourceGameCount: number;
    readonly maxScenariosPerSourceGame: number;
    readonly diversityPenalty: number;
  };
  readonly counts: {
    readonly difficulty: Readonly<Record<string, number>>;
    readonly importance: Readonly<Record<string, number>>;
    readonly family: Readonly<Record<AnnotationFamily, number>>;
    readonly candidatePoolFamily: Readonly<Record<AnnotationFamily, number>>;
    readonly sourceGameCoverage: {
      readonly scanned: number;
      readonly withCandidates: number;
      readonly selected: number;
      readonly maxSelectedPerGame: number;
    };
  };
  readonly batchSha256: string;
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

export interface AnnotationRestoreSummary {
  sourceBatch: string;
  catalogSha256: string;
  retained: number;
  wouldActivate: number;
  activated: number;
  wouldDeactivate: number;
  deactivated: number;
  applied: boolean;
}

export interface AnnotationRestoreOptions {
  apply: boolean;
  validatePlan?: (summary: AnnotationRestoreSummary) => void;
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

function countRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, number> {
  const record = recordAt(value, path);
  exactKeys(record, keys, path);
  return Object.fromEntries(
    keys.map((key) => [key, integerAt(record[key], `${path}.${key}`, 0)]),
  );
}

function familyQuotas(scenarioCount: number): Record<AnnotationFamily, number> {
  const base = Math.floor(scenarioCount / ANNOTATION_FAMILIES.length);
  const remainder = scenarioCount % ANNOTATION_FAMILIES.length;
  return Object.fromEntries(
    ANNOTATION_FAMILIES.map((family, index) => [
      family,
      base + (index < remainder ? 1 : 0),
    ]),
  ) as Record<AnnotationFamily, number>;
}

function expectedBatchCounts(
  scenarios: readonly AnnotationScenarioInput[],
): {
  difficulty: Record<string, number>;
  importance: Record<string, number>;
  family: Record<AnnotationFamily, number>;
} {
  const difficulty = Object.fromEntries(
    ANNOTATION_DIFFICULTIES.map((value) => [value, 0]),
  );
  const importance = Object.fromEntries(
    Object.values(ANNOTATION_IMPORTANCE).map((value) => [String(value), 0]),
  );
  const family = Object.fromEntries(
    ANNOTATION_FAMILIES.map((value) => [value, 0]),
  ) as Record<AnnotationFamily, number>;

  scenarios.forEach((scenario) => {
    if (
      scenario.importance !== ANNOTATION_IMPORTANCE.useful ||
      scenario.tags.length !== 1 ||
      !ANNOTATION_FAMILIES.some((family) => family === scenario.tags[0])
    ) {
      throw new Error(
        "annotation batch scenarios must use one V2 family and useful importance",
      );
    }
    difficulty[scenario.predictedDifficulty] += 1;
    importance[String(scenario.importance)] += 1;
    family[scenario.tags[0] as AnnotationFamily] += 1;
  });
  return { difficulty, importance, family };
}

function parseManifest(
  value: unknown,
  scenarios: readonly AnnotationScenarioInput[],
  batchSha256: string,
): AnnotationBatchManifest {
  const manifest = recordAt(value, "annotation manifest");
  exactKeys(
    manifest,
    [
      "batchId",
      "seedFingerprint",
      "generatorCommit",
      "modelSha256",
      "rulesVersion",
      "methodVersion",
      "parameters",
      "counts",
      "batchSha256",
    ],
    "annotation manifest",
  );
  if (
    typeof manifest.batchId !== "string" ||
    !BATCH_ID_PATTERN.test(manifest.batchId)
  ) {
    throw new Error("annotation manifest batchId is invalid");
  }
  for (const key of [
    "seedFingerprint",
    "modelSha256",
    "batchSha256",
  ] as const) {
    if (
      typeof manifest[key] !== "string" ||
      !SHA256_PATTERN.test(manifest[key])
    ) {
      throw new Error(`annotation manifest ${key} is invalid`);
    }
  }
  nonEmptyStringAt(
    manifest.generatorCommit,
    "annotation manifest.generatorCommit",
  );
  if (
    manifest.rulesVersion !== RULES_VERSION ||
    manifest.methodVersion !== METHOD_VERSION
  ) {
    throw new Error("annotation manifest rules or method version is invalid");
  }

  const parameters = recordAt(
    manifest.parameters,
    "annotation manifest.parameters",
  );
  exactKeys(
    parameters,
    [
      "scenarioCount",
      "familyQuotas",
      "sourceGameCount",
      "maxScenariosPerSourceGame",
      "diversityPenalty",
    ],
    "annotation manifest.parameters",
  );
  const scenarioCount = integerAt(
    parameters.scenarioCount,
    "annotation manifest.parameters.scenarioCount",
    1,
  );
  const quotas = countRecord(
    parameters.familyQuotas,
    ANNOTATION_FAMILIES,
    "annotation manifest.parameters.familyQuotas",
  );
  const sourceGameCount = integerAt(
    parameters.sourceGameCount,
    "annotation manifest.parameters.sourceGameCount",
    1,
  );
  if (
    scenarioCount !== scenarios.length ||
    canonicalJson(quotas) !== canonicalJson(familyQuotas(scenarioCount)) ||
    parameters.maxScenariosPerSourceGame !== MAX_SCENARIOS_PER_SOURCE_GAME ||
    parameters.diversityPenalty !== DIVERSITY_PENALTY
  ) {
    throw new Error("annotation manifest parameters are invalid");
  }

  for (const [index, scenario] of scenarios.entries()) {
    if (
      scenario.code !==
      `${manifest.batchId}-${String(index + 1).padStart(5, "0")}`
    ) {
      throw new Error(
        "annotation batch scenario codes do not match manifest batchId",
      );
    }
  }
  const expectedCounts = expectedBatchCounts(scenarios);
  if (
    canonicalJson(expectedCounts.family) !== canonicalJson(quotas)
  ) {
    throw new Error("annotation batch does not satisfy manifest family quotas");
  }

  const counts = recordAt(manifest.counts, "annotation manifest.counts");
  exactKeys(
    counts,
    [
      "difficulty",
      "importance",
      "family",
      "candidatePoolFamily",
      "sourceGameCoverage",
    ],
    "annotation manifest.counts",
  );
  const difficulty = countRecord(
    counts.difficulty,
    ANNOTATION_DIFFICULTIES,
    "annotation manifest.counts.difficulty",
  );
  const importance = countRecord(
    counts.importance,
    Object.values(ANNOTATION_IMPORTANCE).map(String),
    "annotation manifest.counts.importance",
  );
  const family = countRecord(
    counts.family,
    ANNOTATION_FAMILIES,
    "annotation manifest.counts.family",
  );
  if (
    canonicalJson({ difficulty, importance, family }) !==
    canonicalJson(expectedCounts)
  ) {
    throw new Error("annotation manifest counts do not match the batch");
  }

  const candidatePoolFamily = countRecord(
    counts.candidatePoolFamily,
    ANNOTATION_FAMILIES,
    "annotation manifest.counts.candidatePoolFamily",
  );
  if (
    ANNOTATION_FAMILIES.some(
      (name) => candidatePoolFamily[name] < expectedCounts.family[name],
    )
  ) {
    throw new Error("annotation manifest candidate-pool counts are invalid");
  }

  const coverage = recordAt(
    counts.sourceGameCoverage,
    "annotation manifest.counts.sourceGameCoverage",
  );
  exactKeys(
    coverage,
    ["scanned", "withCandidates", "selected", "maxSelectedPerGame"],
    "annotation manifest.counts.sourceGameCoverage",
  );
  const scanned = integerAt(
    coverage.scanned,
    "annotation manifest.counts.sourceGameCoverage.scanned",
    1,
  );
  const withCandidates = integerAt(
    coverage.withCandidates,
    "annotation manifest.counts.sourceGameCoverage.withCandidates",
    1,
  );
  const selected = integerAt(
    coverage.selected,
    "annotation manifest.counts.sourceGameCoverage.selected",
    1,
  );
  const maxSelectedPerGame = integerAt(
    coverage.maxSelectedPerGame,
    "annotation manifest.counts.sourceGameCoverage.maxSelectedPerGame",
    1,
  );
  if (
    scanned !== sourceGameCount ||
    selected > withCandidates ||
    withCandidates > scanned ||
    selected > scenarioCount ||
    maxSelectedPerGame > MAX_SCENARIOS_PER_SOURCE_GAME ||
    selected * maxSelectedPerGame < scenarioCount
  ) {
    throw new Error("annotation manifest source-game coverage is invalid");
  }
  if (manifest.batchSha256 !== batchSha256) {
    throw new Error("annotation batch bytes do not match manifest batchSha256");
  }
  return manifest as unknown as AnnotationBatchManifest;
}

export async function readAnnotationBatch(
  batchPath: string,
  manifestPath: string,
) {
  const [batchBytes, manifestBytes] = await Promise.all([
    readFile(batchPath),
    readFile(manifestPath),
  ]);
  let batchValue: unknown;
  let manifestValue: unknown;
  try {
    batchValue = JSON.parse(batchBytes.toString("utf8"));
    manifestValue = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("annotation batch and manifest must be valid UTF-8 JSON");
  }
  if (
    !batchBytes.equals(Buffer.from(`${canonicalJson(batchValue)}\n`)) ||
    !manifestBytes.equals(Buffer.from(`${canonicalJson(manifestValue)}\n`))
  ) {
    throw new Error("annotation batch and manifest must use canonical JSON");
  }
  const scenarios = parseAnnotationScenarioBatch(batchValue);
  const batchSha256 = createHash("sha256").update(batchBytes).digest("hex");
  const manifest = parseManifest(
    manifestValue,
    scenarios,
    batchSha256,
  );
  const manifestSha256 = createHash("sha256")
    .update(manifestBytes)
    .digest("hex");
  return { manifest, manifestSha256, scenarios };
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

async function readAnnotationCatalog(
  tx: Prisma.TransactionClient,
): Promise<AnnotationCatalogRow[]> {
  return tx.annotationScenario.findMany({
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
        const catalog = await readAnnotationCatalog(tx);
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

export async function restoreActiveAnnotationBatch(
  sourceBatch: string,
  options: AnnotationRestoreOptions,
  client?: PrismaClient,
): Promise<AnnotationRestoreSummary> {
  if (!BATCH_ID_PATTERN.test(sourceBatch)) {
    throw new Error("restore source batch is invalid");
  }
  const prisma = client ?? new PrismaClient({ log: [] });
  try {
    return await prisma.$transaction(
      async (tx) => {
        const catalog = await readAnnotationCatalog(tx);
        const retained = catalog.filter(
          (scenario) => scenario.sourceBatch === sourceBatch,
        );
        if (retained.length === 0) {
          throw new Error(
            `no retained annotation batch found for ${sourceBatch}`,
          );
        }
        const plan: AnnotationRestoreSummary = {
          sourceBatch,
          catalogSha256: annotationCatalogSha256(catalog),
          retained: retained.length,
          wouldActivate: retained.filter((scenario) => !scenario.active).length,
          activated: 0,
          wouldDeactivate: catalog.filter(
            (scenario) =>
              scenario.active && scenario.sourceBatch !== sourceBatch,
          ).length,
          deactivated: 0,
          applied: false,
        };
        if (!options.apply) return plan;

        options.validatePlan?.(plan);
        const activated = await tx.annotationScenario.updateMany({
          where: { sourceBatch, active: false },
          data: { active: true },
        });
        const deactivated = await tx.annotationScenario.updateMany({
          where: { sourceBatch: { not: sourceBatch }, active: true },
          data: { active: false },
        });
        return {
          ...plan,
          activated: activated.count,
          deactivated: deactivated.count,
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
