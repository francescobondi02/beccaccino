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
