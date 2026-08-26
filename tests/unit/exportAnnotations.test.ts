import { Suit, Value } from "@prisma/client";
import { annotationExportRecord } from "../../src/scripts/exportAnnotations";
import {
  annotationScenarioInput,
} from "../helpers/annotationScenario";

const scenario = annotationScenarioInput();
const annotation = {
  userId: 7,
  scenarioId: 11,
  scenarioHash: scenario.stateHash,
  selectedSuit: Suit.denara,
  selectedValue: Value.asso,
  selectedSignal: null,
  skipped: false,
  comment: null,
  perceivedDifficulty: "hard",
  responseTimeMs: 1234,
  createdAt: new Date("2026-08-26T10:00:00.000Z"),
  updatedAt: new Date("2026-08-26T10:00:01.000Z"),
  scenario: {
    code: scenario.code,
    predictedDifficulty: scenario.predictedDifficulty,
    importance: scenario.importance,
    tags: [...scenario.tags],
    state: scenario.state,
    stateHash: scenario.stateHash,
    sourceBatch: "initial-v1",
  },
};

describe("annotation export records", () => {
  it("includes the complete saved scenario and a pseudonymous response", () => {
    const record = annotationExportRecord(
      annotation,
      "stable-export-salt",
    );

    expect(record.annotatorPseudonym).toMatch(/^[a-f0-9]{64}$/);
    expect(record.scenario).toMatchObject({
      id: 11,
      code: scenario.code,
      stateHash: scenario.stateHash,
      predictedDifficulty: "medium",
      importance: 2,
      tags: ["must_follow"],
      hand: scenario.state.hand,
      legalActions: scenario.state.legalActions,
    });
    expect(record.selectedAction).toEqual(scenario.state.legalActions[0]);
    expect(record).not.toHaveProperty("userId");
  });

  it("rejects stale hashes, illegal actions, and weak export salts", () => {
    expect(() =>
      annotationExportRecord(
        { ...annotation, scenarioHash: "0".repeat(64) },
        "stable-export-salt",
      ),
    ).toThrow(/invalid scenario/);
    expect(() =>
      annotationExportRecord(
        { ...annotation, selectedSuit: Suit.coppe },
        "stable-export-salt",
      ),
    ).toThrow(/illegal selected action/);
    expect(() => annotationExportRecord(annotation, "short")).toThrow(
      /at least 16 characters/,
    );
  });
});
