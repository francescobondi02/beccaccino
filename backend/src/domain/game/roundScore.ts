import { Suit, Value } from "./cards";
import { determineTrickWinner } from "./trickWinner";

// Raw points are thirds of a real point. The last trick adds three raw points.
export function computeRoundScore(
  tricks: {
    winnerId: number | null;
    cards: { value: Value; suit: Suit; playerId: number }[];
  }[],
  playerTeams: Record<number, number>,
  briscola: Suit,
) {
  const cardPoints: Record<Value, number> = {
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

  const rawScores = {
    team0: 0,
    team1: 0,
  };

  let lastTrickWinnerId: number | null = null;

  for (let i = 0; i < tricks.length; i++) {
    const trick = tricks[i];
    const winnerPlayerId =
      trick.winnerId !== null
        ? trick.winnerId
        : determineTrickWinner(trick.cards, briscola);

    const team = playerTeams[winnerPlayerId];

    for (const card of trick.cards) {
      const points = cardPoints[card.value];
      if (team === 0) {
        rawScores.team0 += points;
      } else if (team === 1) {
        rawScores.team1 += points;
      }
    }

    if (i === tricks.length - 1) {
      lastTrickWinnerId = winnerPlayerId;
    }
  }

  if (lastTrickWinnerId !== null) {
    const lastTrickWinnerTeam = playerTeams[lastTrickWinnerId];
    if (lastTrickWinnerTeam === 0) {
      rawScores.team0 += 3;
    } else if (lastTrickWinnerTeam === 1) {
      rawScores.team1 += 3;
    }
  }

  return rawScores;
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
