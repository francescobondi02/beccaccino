import { Value } from "./cards";

const CARD_POINTS: Record<Value, number> = {
  asso: 3,
  tre: 1,
  due: 1,
  re: 1,
  cavallo: 1,
  fante: 1,
  quattro: 0,
  cinque: 0,
  sei: 0,
  sette: 0,
};

// Raw points are thirds of a real point. The last trick adds three raw points.
export function computeRoundScore(
  tricks: { winnerId: number; cards: { value: Value }[] }[],
  playerTeams: Record<number, number>,
) {
  const raw = { team0: 0, team1: 0 };
  for (const [i, trick] of tricks.entries()) {
    let points = i === tricks.length - 1 ? 3 : 0;
    for (const card of trick.cards) points += CARD_POINTS[card.value];
    const team = playerTeams[trick.winnerId];
    if (team === 0) raw.team0 += points;
    else if (team === 1) raw.team1 += points;
  }
  return raw;
}

/**
 * Adds the caller team's 3-point cricca bonus, then picks the round winner:
 * more raw points; an exact tie goes to team 0.
 */
export function settleRound(
  raw: { team0: number; team1: number },
  criccaTeam: number | null,
) {
  const team0Raw = raw.team0 + (criccaTeam === 0 ? 9 : 0);
  const team1Raw = raw.team1 + (criccaTeam === 1 ? 9 : 0);
  return { team0Raw, team1Raw, winnerTeam: team1Raw > team0Raw ? 1 : 0 };
}
