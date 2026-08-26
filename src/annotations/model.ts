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

export interface AnnotationAction extends AnnotationCard {
  signal: AnnotationSignal;
}

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

export interface AnnotationScenario {
  id: number;
  code: string;
  stateHash: string;
  targetPoints: number;
  roundNumber: number;
  actingSeat: AnnotationSeat;
  callerSeat: AnnotationSeat;
  trickStarter: AnnotationSeat;
  briscola: AnnotationSuit;
  totalScores: { 0: number; 1: number };
  hand: AnnotationCard[];
  completedTricks: Array<AnnotationTrick & { winnerSeat: AnnotationSeat }>;
  currentTrick: AnnotationTrick;
  legalActions: AnnotationAction[];
}

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
  selectedAction: AnnotationAction | null;
  skipped: boolean;
  comment: string | null;
  perceivedDifficulty: AnnotationDifficulty;
  responseTimeMs: number;
}

export interface AnnotationResponseResult {
  contributionCount: number;
}
