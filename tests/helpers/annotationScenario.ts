import { Prisma, Suit, Value } from "@prisma/client";
import {
  AnnotationScenarioInput,
  AnnotationScenarioState,
  annotationStateHash,
} from "../../src/annotations/scenario";

export function annotationScenarioState(
  overrides: Partial<AnnotationScenarioState> = {},
): AnnotationScenarioState {
  return {
    targetPoints: 41,
    roundNumber: 1,
    actingSeat: 1,
    callerSeat: 0,
    trickStarter: 0,
    briscola: Suit.coppe,
    totalScores: { 0: 0, 1: 0 },
    hand: [
      { suit: Suit.denara, value: Value.asso },
      { suit: Suit.denara, value: Value.due },
      { suit: Suit.coppe, value: Value.tre },
      { suit: Suit.coppe, value: Value.re },
      { suit: Suit.spade, value: Value.asso },
      { suit: Suit.spade, value: Value.fante },
      { suit: Suit.spade, value: Value.sette },
      { suit: Suit.bastoni, value: Value.due },
      { suit: Suit.bastoni, value: Value.cavallo },
      { suit: Suit.bastoni, value: Value.cinque },
    ],
    completedTricks: [],
    currentTrick: {
      number: 1,
      starterSeat: 0,
      signal: null,
      signalSeat: null,
      plays: [
        {
          position: 0,
          seat: 0,
          suit: Suit.denara,
          value: Value.quattro,
        },
      ],
    },
    legalActions: [
      { suit: Suit.denara, value: Value.asso, signal: null },
      { suit: Suit.denara, value: Value.due, signal: null },
    ],
    ...overrides,
  };
}

export function annotationScenarioInput(
  overrides: Partial<AnnotationScenarioInput> = {},
): AnnotationScenarioInput {
  const state = overrides.state ?? annotationScenarioState();
  return {
    code: "initial-v1-0001",
    predictedDifficulty: "medium",
    importance: 2,
    tags: ["must_follow"],
    stateHash: annotationStateHash(state),
    state,
    ...overrides,
  };
}

export function annotationScenarioCreateData(
  overrides: Partial<AnnotationScenarioInput> = {},
) {
  const scenario = annotationScenarioInput(overrides);
  return {
    code: scenario.code,
    predictedDifficulty: scenario.predictedDifficulty,
    importance: scenario.importance,
    tags: [...scenario.tags],
    stateHash: scenario.stateHash,
    state: scenario.state as unknown as Prisma.InputJsonValue,
    sourceBatch: "initial-v1",
  };
}
