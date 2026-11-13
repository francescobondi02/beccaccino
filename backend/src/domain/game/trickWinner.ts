import { Suit, Value } from "./cards";

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

export function determineTrickWinner(
  playedCards: { playerId: number; suit: Suit; value: Value }[],
  briscolaSuit: Suit | null
): number {
  if (playedCards.length === 0) throw new Error("No cards played");

  const leadSuit = playedCards[0].suit;

  let winningCard: { playerId: number; strength: number } | null = null;
  const hasBriscola =
    briscolaSuit !== null && playedCards.some((card) => card.suit === briscolaSuit);

  for (const card of playedCards) {
    const isBriscola = briscolaSuit && card.suit === briscolaSuit;
    const followsLeadSuit = card.suit === leadSuit;

    if (hasBriscola && !isBriscola) continue;
    if (!hasBriscola && !followsLeadSuit) continue;

    const strength = cardStrength[card.value];

    if (!winningCard || strength > winningCard.strength) {
      winningCard = { playerId: card.playerId, strength };
    }
  }

  if (!winningCard) throw new Error("No valid winner found — logic error");

  return winningCard.playerId;
}
