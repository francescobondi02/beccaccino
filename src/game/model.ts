import type { GameFinishedPayload } from "@/sockets/events";

export type Signal = "striscio" | "busso" | "volo";
export type PlayerPosition = "bottom" | "top" | "left" | "right";

export interface PlayerCard {
  id: number;
  suit: string;
  value: string;
  playerId: number;
  roundId: number;
  inHand: boolean;
}

export interface RoundDeal {
  readyAt: number;
  animationMs: number;
  reviewMs: number;
}

export interface RoundDealView {
  phase: "collecting" | "dealing" | "reviewing" | "ready";
  dealtCards: number;
  startedAt: number;
  animationMs: number;
}

export interface PlayedCardData {
  playerId: number;
  userId: number;
  suit: string;
  value: string;
  position: number;
  signal?: Signal | null;
  handNumber?: number;
}

export interface TotalPoints {
  team0Points: number;
  team1Points: number;
  team0Figures: number;
  team1Figures: number;
}

// totalMs is null for bot turns. startedAt uses the client clock so server
// clock skew cannot corrupt the countdown.
export interface TurnTimer {
  turnUserId: number;
  totalMs: number | null;
  startedAt: number;
  phase: string;
}

export interface RoundEndData {
  roundNumber: number;
  team0Points: number;
  team1Points: number;
  team0Figures?: number;
  team1Figures?: number;
  winnerTeam: number;
}

export interface MoveLogEntry {
  handNumber: number | null;
  username: string;
  suit: string;
  value: string;
  signal?: Signal | null;
}

export interface RevealedHand {
  userId: number;
  botModel: string | null;
  cards: { suit: string; value: string }[];
}

// Response from GET /games/:code/state.
export interface GameStateResponse {
  status: "choosing_briscola" | "playing" | "paused" | "finished";
  pausedAt: string | null;
  roundSummary?: RoundEndData | null;
  round: {
    id: number;
    number: number;
    briscola: string | null;
    cricca?: boolean;
    deal?: { remainingMs: number; animationMs: number; reviewMs: number } | null;
  };
  currentHandNumber: number | null;
  callerUserId: number | null;
  myCards: PlayerCard[];
  currentTurnUserId: number | null;
  playedCards: PlayedCardData[];
  lastHandCards: PlayedCardData[];
  totalPoints: TotalPoints;
  turnTimer: {
    turnUserId: number;
    remainingMs: number;
    totalMs: number;
    phase: string;
  } | null;
  finishedGame: GameFinishedPayload | null;
  isPractice: boolean;
  allHands: RevealedHand[] | null;
}
