export type TurnPhase = "play_card" | "choose_briscola";

export type TurnIdentity = {
  roundId: number;
  handId: number | null;
  playedCardCount: number;
};

export function isSameTurn(
  first: TurnIdentity,
  second: TurnIdentity,
): boolean {
  return (
    first.roundId === second.roundId &&
    first.handId === second.handId &&
    first.playedCardCount === second.playedCardCount
  );
}

export type RuntimeDirective =
  | {
      kind: "schedule";
      roomCode: string;
      userId: number;
      phase: TurnPhase;
      pauseEpoch: number;
      identity: TurnIdentity;
    }
  | { kind: "clear"; roomCode: string };

export type GameEvent = {
  target: string;
  event: string;
  payload: unknown;
};

export type TransitionOutcome<T> = {
  value: T;
  runtime: RuntimeDirective | null;
  events: GameEvent[];
};
