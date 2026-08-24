import { Suit, Value } from "../domain/cards";

const cardStrength: Record<Value, number> = {
  [Value.tre]: 10,
  [Value.due]: 9,
  [Value.asso]: 8,
  [Value.re]: 7,
  [Value.cavallo]: 6,
  [Value.fante]: 5,
  [Value.sette]: 4,
  [Value.sei]: 3,
  [Value.cinque]: 2,
  [Value.quattro]: 1,
};

export function determineHandWinner(
  playedCards: { playerId: number; suit: Suit; value: Value }[],
  briscolaSuit: Suit | null
): number {
  if (playedCards.length === 0) throw new Error("No cards played");

  const firstSuit = playedCards[0].suit;

  let bestCard: { playerId: number; score: number } | null = null;
  const hasBriscola =
    briscolaSuit !== null && playedCards.some((c) => c.suit === briscolaSuit);

  for (const card of playedCards) {
    const isBriscola = briscolaSuit && card.suit === briscolaSuit;
    const isSameSuit = card.suit === firstSuit;

    // Se ci sono briscole, ignoriamo carte di altri semi
    if (hasBriscola && !isBriscola) continue;
    // Se non ci sono briscole, ignoriamo carte di seme diverso dal primo
    if (!hasBriscola && !isSameSuit) continue;

    const score = cardStrength[card.value];

    if (!bestCard || score > bestCard.score) {
      bestCard = { playerId: card.playerId, score };
    }
  }

  if (!bestCard) throw new Error("No valid winner found — logic error");

  return bestCard.playerId;
}
