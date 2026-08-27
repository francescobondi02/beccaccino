import { Suit, Value } from "@prisma/client";
import { annotationExportRecord } from "../../src/scripts/exportAnnotations";
import {
  annotationScenarioInput,
  chooseBriscolaScenarioInput,
} from "../helpers/annotationScenario";

const scenario = annotationScenarioInput();
const annotation = {
  userId: 7,
  scenarioId: 11,
  scenarioHash: scenario.stateHash,
  selectedSuit: Suit.denara,
  selectedValue: Value.asso,
  selectedSignal: null,
  selectedBriscola: null,
  skipped: false,
  comment: null,
  perceivedDifficulty: "hard",
  responseTimeMs: 1234,
  createdAt: new Date("2026-08-26T10:00:00.000Z"),
  updatedAt: new Date("2026-08-26T10:00:01.000Z"),
  scenario: {
    code: scenario.code,
    decisionType: scenario.decisionType,
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
      decisionType: "play_card",
      stateHash: scenario.stateHash,
      predictedDifficulty: "medium",
      importance: 2,
      tags: ["must_follow"],
      hand: scenario.state.hand,
      legalActions: scenario.state.legalActions,
    });
    expect(record.selectedAction).toEqual({
      decisionType: "play_card",
      ...scenario.state.legalActions[0],
    });
    expect(record).not.toHaveProperty("userId");
  });

  it("exports a self-contained briscola choice", () => {
    const briscolaScenario = chooseBriscolaScenarioInput();
    const record = annotationExportRecord(
      {
        ...annotation,
        selectedSuit: null,
        selectedValue: null,
        selectedBriscola: Suit.spade,
        scenario: {
          code: briscolaScenario.code,
          decisionType: briscolaScenario.decisionType,
          predictedDifficulty: briscolaScenario.predictedDifficulty,
          importance: briscolaScenario.importance,
          tags: [...briscolaScenario.tags],
          state: briscolaScenario.state,
          stateHash: briscolaScenario.stateHash,
          sourceBatch: "annotator-v2",
        },
        scenarioHash: briscolaScenario.stateHash,
      },
      "stable-export-salt",
    );

    expect(record.scenario).toMatchObject({
      decisionType: "choose_briscola",
      hand: briscolaScenario.state.hand,
      legalActions: briscolaScenario.state.legalActions,
    });
    expect(record.selectedAction).toEqual({
      decisionType: "choose_briscola",
      suit: Suit.spade,
    });
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
    expect(() =>
      annotationExportRecord(
        { ...annotation, selectedBriscola: Suit.coppe },
        "stable-export-salt",
      ),
    ).toThrow(/mismatched selected action columns/);
    expect(() => annotationExportRecord(annotation, "short")).toThrow(
      /at least 16 characters/,
    );
  });
});
