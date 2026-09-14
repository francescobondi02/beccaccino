import {
  isAnnotationDifficulty,
  isAnnotationImportance,
  isAnnotationTag,
} from "./constants";
import { AnnotationScenarioInput } from "./contracts";
import {
  exactKeys,
  nonEmptyStringAt,
  recordAt,
} from "./parsing";
import { parseAnnotationScenario } from "./state";

export function parseAnnotationScenarioBatch(
  value: unknown,
): readonly AnnotationScenarioInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("annotation scenario batch must be a non-empty array");
  }
  const codes = new Set<string>();
  const hashes = new Set<string>();
  return value.map((rawScenario, index) => {
    const path = `annotation scenario batch[${index}]`;
    const record = recordAt(rawScenario, path);
    exactKeys(
      record,
      [
        "code",
        "decisionType",
        "predictedDifficulty",
        "importance",
        "tags",
        "stateHash",
        "state",
      ],
      path,
    );
    const code = nonEmptyStringAt(record.code, `${path}.code`);
    if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(code)) {
      throw new Error(`${path}.code must be a lowercase stable identifier`);
    }
    if (!isAnnotationDifficulty(record.predictedDifficulty)) {
      throw new Error(`${path}.predictedDifficulty is invalid`);
    }
    if (!isAnnotationImportance(record.importance)) {
      throw new Error(`${path}.importance is invalid`);
    }
    if (
      !Array.isArray(record.tags) ||
      record.tags.length === 0 ||
      !record.tags.every(isAnnotationTag) ||
      new Set(record.tags).size !== record.tags.length
    ) {
      throw new Error(`${path}.tags must be unique fixed annotation tags`);
    }
    const stateHash = nonEmptyStringAt(record.stateHash, `${path}.stateHash`);
    if (!/^[a-f0-9]{64}$/.test(stateHash)) {
      throw new Error(`${path}.stateHash must be a lowercase SHA-256 hash`);
    }
    if (codes.has(code) || hashes.has(stateHash)) {
      throw new Error(`${path} duplicates a code or state hash`);
    }
    codes.add(code);
    hashes.add(stateHash);
    const parsed = parseAnnotationScenario(
      record.decisionType,
      record.state,
      stateHash,
    );
    return {
      code,
      predictedDifficulty: record.predictedDifficulty,
      importance: record.importance,
      tags: record.tags,
      stateHash,
      ...parsed,
    };
  });
}
