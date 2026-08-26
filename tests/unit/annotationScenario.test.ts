import {
  annotationStateHash,
  parseAnnotationScenarioBatch,
  parseAnnotationScenarioState,
} from "../../src/annotations/scenario";
import {
  annotationScenarioInput,
  annotationScenarioState,
} from "../helpers/annotationScenario";

describe("annotation scenarios", () => {
  it("validates a saved public state and its canonical hash", () => {
    const scenario = annotationScenarioInput();

    expect(parseAnnotationScenarioBatch([scenario])).toEqual([scenario]);
    expect(parseAnnotationScenarioState(scenario.state, scenario.stateHash)).toEqual(
      scenario.state,
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
