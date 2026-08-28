import {
  isAnnotationActionLegal,
  parseAnnotationSelectedAction,
} from "../../src/annotations/action";
import { parseAnnotationScenarioBatch } from "../../src/annotations/batch";
import {
  annotationStateHash,
  parseAnnotationScenario,
} from "../../src/annotations/state";
import {
  annotationScenarioInput,
  annotationScenarioState,
  chooseBriscolaScenarioInput,
  chooseBriscolaScenarioState,
} from "../helpers/annotationScenario";

describe("annotation scenarios", () => {
  it("validates both discriminated public-state shapes and canonical hashes", () => {
    const card = annotationScenarioInput();
    const briscola = chooseBriscolaScenarioInput();

    expect(parseAnnotationScenarioBatch([card, briscola])).toEqual([
      card,
      briscola,
    ]);
    expect(
      parseAnnotationScenario(card.decisionType, card.state, card.stateHash),
    ).toEqual({
      decisionType: "play_card",
      state: card.state,
    });
    expect(
      parseAnnotationScenario(
        briscola.decisionType,
        briscola.state,
        briscola.stateHash,
      ),
    ).toEqual({
      decisionType: "choose_briscola",
      state: briscola.state,
    });
  });

  it("requires decisionType on imported batches and rejects cross-type state", () => {
    const card = annotationScenarioInput();
    const missingDecisionType = { ...card } as Record<string, unknown>;
    delete missingDecisionType.decisionType;

    expect(() => parseAnnotationScenarioBatch([missingDecisionType])).toThrow(
      /must contain only/,
    );
    expect(() =>
      parseAnnotationScenarioBatch([
        { ...chooseBriscolaScenarioInput(), decisionType: "play_card" },
      ]),
    ).toThrow(/must contain only/);
  });

  it("enforces exact discriminated selected-action shapes and legality", () => {
    const cardScenario = parseAnnotationScenario(
      "play_card",
      annotationScenarioInput().state,
    );
    const briscolaScenario = parseAnnotationScenario(
      "choose_briscola",
      chooseBriscolaScenarioInput().state,
    );
    const cardAction = parseAnnotationSelectedAction({
      decisionType: "play_card",
      suit: "denara",
      value: "asso",
      signal: null,
    });
    const briscolaAction = parseAnnotationSelectedAction({
      decisionType: "choose_briscola",
      suit: "coppe",
    });
    const legacyCardAction = parseAnnotationSelectedAction({
      suit: "denara",
      value: "asso",
      signal: null,
    });

    expect(isAnnotationActionLegal(cardScenario, cardAction)).toBe(true);
    expect(legacyCardAction).toEqual(cardAction);
    expect(isAnnotationActionLegal(briscolaScenario, briscolaAction)).toBe(true);
    expect(isAnnotationActionLegal(cardScenario, briscolaAction)).toBe(false);
    expect(() =>
      parseAnnotationSelectedAction({
        decisionType: "choose_briscola",
        suit: "coppe",
        value: "asso",
      }),
    ).toThrow(/must contain only/);
  });

  it("requires exactly the four legal briscola suits", () => {
    const engineOrder = chooseBriscolaScenarioState({
      legalActions: ["denara", "spade", "coppe", "bastoni"],
    });
    const validScenario = {
      ...chooseBriscolaScenarioInput({ state: engineOrder }),
      stateHash: annotationStateHash(engineOrder),
    };
    const state = chooseBriscolaScenarioState({
      legalActions: [
        "coppe",
        "denara",
        "spade",
        "spade",
      ],
    });
    const scenario = {
      ...chooseBriscolaScenarioInput({ state }),
      stateHash: annotationStateHash(state),
    };

    expect(parseAnnotationScenarioBatch([validScenario])).toEqual([
      validScenario,
    ]);
    expect(() => parseAnnotationScenarioBatch([scenario])).toThrow(
      /all four suits/,
    );
  });

  it("rejects hidden fields and state tampering", () => {
    const scenario = annotationScenarioInput();
    const hidden = {
      ...scenario,
      state: { ...scenario.state, hiddenHands: [] },
    };
    expect(() => parseAnnotationScenarioBatch([hidden])).toThrow(
      /must contain only/,
    );

    const changed = {
      ...scenario,
      state: {
        ...scenario.state,
        totalScores: { ...scenario.state.totalScores, 0: 3 },
      },
    };
    expect(() => parseAnnotationScenarioBatch([changed])).toThrow(
      /hash does not match/,
    );
  });

  it("rejects legal actions that do not match follow-suit rules", () => {
    const state = annotationScenarioState({
      legalActions: [
        { suit: "coppe", value: "tre", signal: null },
      ],
    });
    const scenario = {
      ...annotationScenarioInput({ state }),
      stateHash: annotationStateHash(state),
    };

    expect(() => parseAnnotationScenarioBatch([scenario])).toThrow(
      /legalActions do not match/,
    );
  });

  it("rejects unknown difficulties, tags, importance, and duplicate states", () => {
    const scenario = annotationScenarioInput();

    for (const invalid of [
      { ...scenario, predictedDifficulty: "expert" },
      { ...scenario, tags: ["unknown"] },
      { ...scenario, importance: 4 },
    ]) {
      expect(() => parseAnnotationScenarioBatch([invalid])).toThrow();
    }
    expect(() =>
      parseAnnotationScenarioBatch([
        scenario,
        { ...scenario, code: "initial-v1-0002" },
      ]),
    ).toThrow(/duplicates/);
  });
});
