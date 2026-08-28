export type TurnPhase = "play_card" | "choose_briscola";

export type RuntimeDirective =
  | {
      kind: "schedule";
      roomCode: string;
      userId: number;
      phase: TurnPhase;
      pauseEpoch: number;
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
