export const TABLE_SEATS = 4;

function seatAfter(seat: number, offset = 1): number {
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

export function resolveTurnSeat({
  briscolaChosen,
  callerSeat,
  trick,
}: {
  briscolaChosen: boolean;
  callerSeat: number | null;
  trick?: {
    starterSeat: number;
    playedCardCount: number;
    winnerSeat: number | null;
  } | null;
}): number | null {
  if (!briscolaChosen || !trick) return callerSeat;
  if (trick.playedCardCount < TABLE_SEATS) {
    return seatAfter(trick.starterSeat, trick.playedCardCount);
  }
  return trick.winnerSeat;
}
