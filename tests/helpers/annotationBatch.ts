import { createHash } from "crypto";
import { writeFile } from "fs/promises";
import { join } from "path";
import { AnnotationScenarioInput } from "../../src/annotations/contracts";
import { canonicalJson } from "../../src/annotations/state";

const FAMILIES = ["borderline_briscola", "lead", "risk"] as const;

function quotas(count: number): Record<string, number> {
  const base = Math.floor(count / FAMILIES.length);
  const remainder = count % FAMILIES.length;
  return Object.fromEntries(
    FAMILIES.map((family, index) => [
      family,
      base + (index < remainder ? 1 : 0),
    ]),
  );
}

export function annotationBatchArtifacts(
  scenarios: readonly AnnotationScenarioInput[],
  batchId: string,
  generatorCommit = "ai@test",
) {
  const batchBytes = Buffer.from(`${canonicalJson(scenarios)}\n`);
  const difficulty = { easy: 0, medium: 0, hard: 0 };
  const importance = { "1": 0, "2": 0, "3": 0 };
  const family = { borderline_briscola: 0, lead: 0, risk: 0 };
  for (const scenario of scenarios) {
    difficulty[scenario.predictedDifficulty] += 1;
    importance[String(scenario.importance) as keyof typeof importance] += 1;
    family[scenario.tags[0] as keyof typeof family] += 1;
  }
  const selectedSources = scenarios.length;
  const manifest = {
    batchId,
    seedFingerprint: "a".repeat(64),
    generatorCommit,
    modelSha256: "b".repeat(64),
    rulesVersion: "becca-annotation-rules-v2",
    methodVersion: "offline-full-pool-public-impact-diversity-v2",
    parameters: {
      scenarioCount: scenarios.length,
      familyQuotas: quotas(scenarios.length),
      sourceGameCount: selectedSources,
      maxScenariosPerSourceGame: 2,
      diversityPenalty: 0.12,
    },
    counts: {
      difficulty,
      importance,
      family,
      candidatePoolFamily: { ...family },
      sourceGameCoverage: {
        scanned: selectedSources,
        withCandidates: selectedSources,
        selected: selectedSources,
        maxSelectedPerGame: 1,
      },
    },
    batchSha256: createHash("sha256").update(batchBytes).digest("hex"),
  };
  const manifestBytes = Buffer.from(`${canonicalJson(manifest)}\n`);
  return { batchBytes, manifest, manifestBytes };
}

export async function writeAnnotationBatchFiles(
  directory: string,
  scenarios: readonly AnnotationScenarioInput[],
  batchId: string,
) {
  const batchPath = join(directory, "batch.json");
  const manifestPath = join(directory, "manifest.json");
  const artifacts = annotationBatchArtifacts(scenarios, batchId);
  await Promise.all([
    writeFile(batchPath, artifacts.batchBytes),
    writeFile(manifestPath, artifacts.manifestBytes),
  ]);
  return { batchPath, manifestPath, ...artifacts };
}
