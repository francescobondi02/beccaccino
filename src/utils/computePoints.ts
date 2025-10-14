import { Value } from "@prisma/client";

// Punti moltiplicati * 3 per evitare float:
// - Asso = 3 punti (→ 1 punto reale)
// - Tre, Due, Re, Cavallo, Fante = 1 punto (→ 1/3 punto reale)
// - Altre = 0
export function computePoints(
  hands: { winnerId: number; cards: { value: Value }[] }[],
  teamPlayers: Record<number, number>
) {
  // Punteggi moltiplicati per 3 per evitare float
  const cardPoints: Record<Value, number> = {
    asso: 3, // 1 punto
    tre: 1, // 1/3 punto
    due: 1, // 1/3 punto
    re: 1, // 1/3 punto
    cavallo: 1, // 1/3 punto
    fante: 1, // 1/3 punto
    quattro: 0,
    cinque: 0,
    sei: 0,
    sette: 0,
  };

  const rawScores = {
    team0: 0,
    team1: 0,
  };

  for (const hand of hands) {
    const team = teamPlayers[hand.winnerId]; // 0 or 1
    for (const card of hand.cards) {
      const points = cardPoints[card.value];
      if (team === 0) {
        rawScores.team0 += points;
      } else if (team === 1) {
        rawScores.team1 += points;
      }
    }
  }

  const formatScore = (raw: number) => ({
    raw,
    points: Math.floor(raw / 3),
    figures: raw % 3,
  });

  return {
    team0: formatScore(rawScores.team0),
    team1: formatScore(rawScores.team1),
  };
}
