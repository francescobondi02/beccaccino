export const TABLE_SEATS = 4;

export function seatAfter(seat: number, offset = 1): number {
  return (seat + offset) % TABLE_SEATS;
}

export function nextCallerPlayerId(
  players: { id: number; seat: number | null }[],
  previousCallerId: number,
): number | null {
  const previous = players.find((player) => player.id === previousCallerId);
  if (!previous || previous.seat === null) return null;
  const nextSeat = seatAfter(previous.seat);
  return players.find((player) => player.seat === nextSeat)?.id ?? null;
}

export function resolveCaller<T>({
  roundNumber,
  firstTrickStarter,
  quattroDenaraHolder,
  previousCaller,
  nextCaller,
}: {
  roundNumber: number;
  firstTrickStarter?: T | null;
  quattroDenaraHolder?: T | null;
  previousCaller?: T | null;
  nextCaller: (caller: T) => T | null;
}): T | null {
  if (firstTrickStarter !== undefined && firstTrickStarter !== null) {
    return firstTrickStarter;
  }
  if (roundNumber === 1) {
    return quattroDenaraHolder ?? null;
  }
  return previousCaller === undefined || previousCaller === null
    ? null
    : nextCaller(previousCaller);
}

export function resolveTurnSeat({
  briscolaChosen,
  callerSeat,
  hand,
}: {
  briscolaChosen: boolean;
  callerSeat: number | null;
  hand?: {
    starterSeat: number;
    playedCardCount: number;
    winnerSeat: number | null;
  } | null;
}): number | null {
  if (!briscolaChosen || !hand) return callerSeat;
  if (hand.playedCardCount < TABLE_SEATS) {
    return seatAfter(hand.starterSeat, hand.playedCardCount);
  }
  return hand.winnerSeat;
}
