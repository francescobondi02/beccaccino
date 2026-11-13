export type PlayerPosition = "bottom" | "top" | "left" | "right";

export interface RoundDealView {
  phase: "collecting" | "dealing" | "reviewing" | "ready";
  dealtCards: number;
  startedAt: number;
  animationMs: number;
}
