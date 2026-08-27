import { Prisma, Suit, Value } from "@prisma/client";
import {
  AnnotationChooseBriscolaScenarioInput,
  AnnotationChooseBriscolaScenarioState,
  AnnotationPlayCardScenarioInput,
  AnnotationPlayCardScenarioState,
  annotationStateHash,
} from "../../src/annotations/scenario";

export function annotationScenarioState(
  overrides: Partial<AnnotationPlayCardScenarioState> = {},
): AnnotationPlayCardScenarioState {
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
  overrides: Partial<AnnotationPlayCardScenarioInput> = {},
): AnnotationPlayCardScenarioInput {
  const state = overrides.state ?? annotationScenarioState();
  return {
    code: "initial-v1-0001",
    decisionType: "play_card",
    predictedDifficulty: "medium",
    importance: 2,
    tags: ["must_follow"],
    stateHash: annotationStateHash(state),
    state,
    ...overrides,
  };
}

export function annotationScenarioCreateData(
  overrides: Partial<AnnotationPlayCardScenarioInput> = {},
) {
  const scenario = annotationScenarioInput(overrides);
  return {
    code: scenario.code,
    decisionType: scenario.decisionType,
    predictedDifficulty: scenario.predictedDifficulty,
    importance: scenario.importance,
    tags: [...scenario.tags],
    stateHash: scenario.stateHash,
    state: scenario.state as unknown as Prisma.InputJsonValue,
    sourceBatch: "initial-v1",
  };
}

export function chooseBriscolaScenarioState(
  overrides: Partial<AnnotationChooseBriscolaScenarioState> = {},
): AnnotationChooseBriscolaScenarioState {
  return {
    targetPoints: 41,
    roundNumber: 1,
    actingSeat: 0,
    callerSeat: 0,
    totalScores: { 0: 0, 1: 0 },
    hand: annotationScenarioState().hand,
    legalActions: Object.values(Suit),
    ...overrides,
  };
}

export function chooseBriscolaScenarioInput(
  overrides: Partial<AnnotationChooseBriscolaScenarioInput> = {},
): AnnotationChooseBriscolaScenarioInput {
  const state = overrides.state ?? chooseBriscolaScenarioState();
  return {
    code: "annotator-v2-briscola-0001",
    decisionType: "choose_briscola",
    predictedDifficulty: "medium",
    importance: 2,
    tags: ["borderline_briscola"],
    stateHash: annotationStateHash(state),
    state,
    ...overrides,
  };
}

export function chooseBriscolaScenarioCreateData(
  overrides: Partial<AnnotationChooseBriscolaScenarioInput> = {},
) {
  const scenario = chooseBriscolaScenarioInput(overrides);
  return {
    code: scenario.code,
    decisionType: scenario.decisionType,
    predictedDifficulty: scenario.predictedDifficulty,
    importance: scenario.importance,
    tags: [...scenario.tags],
    stateHash: scenario.stateHash,
    state: scenario.state as unknown as Prisma.InputJsonValue,
    sourceBatch: "annotator-v2",
  };
}
