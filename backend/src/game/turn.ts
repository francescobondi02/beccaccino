export type TurnIdentity = {
  roundId: number;
  trickId: number | null;
  playedCardCount: number;
};

export function isSameTurn(
  first: TurnIdentity,
  second: TurnIdentity,
): boolean {
  return (
    first.roundId === second.roundId &&
    first.trickId === second.trickId &&
    first.playedCardCount === second.playedCardCount
  );
}
