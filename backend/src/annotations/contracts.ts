import {
  AnnotationDifficulty,
  AnnotationImportance,
  AnnotationTag,
} from "./constants";
import { CardSignal, Suit, Value } from "../domain/game/cards";

export type AnnotationSeat = 0 | 1 | 2 | 3;
export type AnnotationDecisionType = "play_card" | "choose_briscola";

export interface AnnotationCard {
  readonly suit: Suit;
  readonly value: Value;
}

export interface AnnotationPlayCardLegalAction extends AnnotationCard {
  readonly signal: CardSignal | null;
}

export interface AnnotationPlayCardAction
  extends AnnotationPlayCardLegalAction {
  readonly decisionType: "play_card";
}

export interface AnnotationChooseBriscolaAction {
  readonly decisionType: "choose_briscola";
  readonly suit: Suit;
}

export type AnnotationSelectedAction =
  | AnnotationPlayCardAction
  | AnnotationChooseBriscolaAction;

export interface AnnotationPlay extends AnnotationCard {
  readonly seat: AnnotationSeat;
  readonly position: number;
}

export interface AnnotationTrick {
  readonly number: number;
  readonly starterSeat: AnnotationSeat;
  readonly signal: CardSignal | null;
  readonly signalSeat: AnnotationSeat | null;
  readonly plays: readonly AnnotationPlay[];
}

export interface CompletedAnnotationTrick extends AnnotationTrick {
  readonly winnerSeat: AnnotationSeat;
}

interface AnnotationScenarioStateBase {
  readonly targetPoints: number;
  readonly roundNumber: number;
  readonly actingSeat: AnnotationSeat;
  readonly callerSeat: AnnotationSeat;
  readonly totalScores: Readonly<{ 0: number; 1: number }>;
  readonly hand: readonly AnnotationCard[];
}

export interface AnnotationPlayCardScenarioState
  extends AnnotationScenarioStateBase {
  readonly trickStarter: AnnotationSeat;
  readonly briscola: Suit;
  readonly completedTricks: readonly CompletedAnnotationTrick[];
  readonly currentTrick: AnnotationTrick;
  readonly legalActions: readonly AnnotationPlayCardLegalAction[];
}

export interface AnnotationChooseBriscolaScenarioState
  extends AnnotationScenarioStateBase {
  readonly legalActions: readonly Suit[];
}

export type AnnotationScenarioState =
  | AnnotationPlayCardScenarioState
  | AnnotationChooseBriscolaScenarioState;

interface AnnotationScenarioInputBase {
  readonly code: string;
  readonly predictedDifficulty: AnnotationDifficulty;
  readonly importance: AnnotationImportance;
  readonly tags: readonly AnnotationTag[];
  readonly stateHash: string;
}

export type AnnotationPlayCardScenarioInput = AnnotationScenarioInputBase & {
  readonly decisionType: "play_card";
  readonly state: AnnotationPlayCardScenarioState;
};

export type AnnotationChooseBriscolaScenarioInput =
  AnnotationScenarioInputBase & {
    readonly decisionType: "choose_briscola";
    readonly state: AnnotationChooseBriscolaScenarioState;
  };

export type AnnotationScenarioInput =
  | AnnotationPlayCardScenarioInput
  | AnnotationChooseBriscolaScenarioInput;

export type ParsedAnnotationScenario =
  | {
      readonly decisionType: "play_card";
      readonly state: AnnotationPlayCardScenarioState;
    }
  | {
      readonly decisionType: "choose_briscola";
      readonly state: AnnotationChooseBriscolaScenarioState;
    };
