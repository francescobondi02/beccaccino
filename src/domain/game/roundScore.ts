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

  const splitRawScore = (rawPoints: number) => ({
    raw: rawPoints,
    points: Math.floor(rawPoints / 3),
    figures: rawPoints % 3,
  });

  return {
    team0: splitRawScore(rawScores.team0),
    team1: splitRawScore(rawScores.team1),
  };
}

/**
 * Adds the caller team's 3-point cricca bonus, then picks the round winner:
 * more points, then more figures; an exact tie goes to team 0.
 */
export function settleRound(
  score: ReturnType<typeof computeRoundScore>,
  criccaTeam: number | null,
) {
  const team0 = { ...score.team0, points: score.team0.points + (criccaTeam === 0 ? 3 : 0) };
  const team1 = { ...score.team1, points: score.team1.points + (criccaTeam === 1 ? 3 : 0) };
  const winnerTeam =
    team0.points !== team1.points
      ? team0.points > team1.points ? 0 : 1
      : team1.figures > team0.figures ? 1 : 0;
  return { team0, team1, winnerTeam };
}
