import { Suit, Value } from "../domain/cards";
import { determineHandWinner } from "./determineHandWinner";

// Punti moltiplicati * 3 per evitare float:
// - Asso = 3 punti (→ 1 punto reale)
// - Tre, Due, Re, Cavallo, Fante = 1 punto (→ 1/3 punto reale)
// - Altre = 0
// + Chi prende l'ultima mano ottiene +1 punto (→ +3 nei punti raw)
export function computePoints(
  hands: {
    winnerId: number | null;
    cards: { value: Value; suit: Suit; playerId: number }[];
  }[],
  teamPlayers: Record<number, number>,
  briscola: Suit,
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

  let lastHandWinner: number | null = null;

  for (let i = 0; i < hands.length; i++) {
    const hand = hands[i];
    const winner =
      hand.winnerId !== null
        ? hand.winnerId
        : determineHandWinner(hand.cards, briscola);

    const team = teamPlayers[winner];

    // Accumula i punti delle carte
    for (const card of hand.cards) {
      const points = cardPoints[card.value];
      if (team === 0) {
        rawScores.team0 += points;
      } else if (team === 1) {
        rawScores.team1 += points;
      }
    }

    // Salva il vincitore dell'ultima mano (hand 10)
    if (i === hands.length - 1) {
      lastHandWinner = winner;
    }
  }

  // Aggiungi il punto bonus (+3 raw) per chi ha preso l'ultima mano
  if (lastHandWinner !== null) {
    const lastTeam = teamPlayers[lastHandWinner];
    if (lastTeam === 0) {
      rawScores.team0 += 3;
    } else if (lastTeam === 1) {
      rawScores.team1 += 3;
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
