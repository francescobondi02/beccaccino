import type { AnnotationDifficulty } from "./constants";

export type AnnotationSuit = "denara" | "coppe" | "spade" | "bastoni";

export type AnnotationValue =
  | "asso"
  | "due"
  | "tre"
  | "quattro"
  | "cinque"
  | "sei"
  | "sette"
  | "fante"
  | "cavallo"
  | "re";

export type AnnotationSignal = "striscio" | "busso" | "volo" | null;
export type AnnotationSeat = 0 | 1 | 2 | 3;

export interface AnnotationCard {
  suit: AnnotationSuit;
  value: AnnotationValue;
}

export interface AnnotationPlayCardAction extends AnnotationCard {
  signal: AnnotationSignal;
}

export type AnnotationSelectedAction =
  | (AnnotationPlayCardAction & { decisionType: "play_card" })
  | { decisionType: "choose_briscola"; suit: AnnotationSuit };

export interface AnnotationPlay extends AnnotationCard {
  seat: AnnotationSeat;
  position: number;
}

export interface AnnotationTrick {
  number: number;
  starterSeat: AnnotationSeat;
  winnerSeat?: AnnotationSeat;
  signal: AnnotationSignal;
  signalSeat: AnnotationSeat | null;
  plays: AnnotationPlay[];
}

interface AnnotationScenarioBase {
  id: number;
  code: string;
  stateHash: string;
  targetPoints: number;
  roundNumber: number;
  actingSeat: AnnotationSeat;
  callerSeat: AnnotationSeat;
  totalScores: { 0: number; 1: number };
  hand: AnnotationCard[];
}

export interface AnnotationPlayCardScenario extends AnnotationScenarioBase {
  decisionType: "play_card";
  trickStarter: AnnotationSeat;
  briscola: AnnotationSuit;
  completedTricks: Array<AnnotationTrick & { winnerSeat: AnnotationSeat }>;
  currentTrick: AnnotationTrick;
  legalActions: AnnotationPlayCardAction[];
}

export interface AnnotationChooseBriscolaScenario
  extends AnnotationScenarioBase {
  decisionType: "choose_briscola";
  legalActions: AnnotationSuit[];
}

export type AnnotationScenario =
  | AnnotationPlayCardScenario
  | AnnotationChooseBriscolaScenario;

export interface AnnotationStatusResponse {
  accessGranted: boolean;
  contributionCount: number;
}

export interface NextAnnotationResponse {
  scenario: AnnotationScenario | null;
  contributionCount: number;
}

export interface AnnotationResponseRequest {
  scenarioId: number;
  scenarioHash: string;
  selectedAction: AnnotationSelectedAction | null;
  skipped: boolean;
  comment: string | null;
  perceivedDifficulty: AnnotationDifficulty;
  responseTimeMs: number;
}

export interface AnnotationResponseResult {
  contributionCount: number;
}
