import { Suit, Value } from "@prisma/client";

export function determineHandWinner(
  playedCards: { playerId: number; suit: Suit; value: Value }[],
  briscolaSuit: Suit | null
): number {
  if (playedCards.length === 0) throw new Error("No cards played");

  // Ordine di presa: punteggi decrescenti
  const strengthOrder: Value[] = [
    "tre",
    "due",
    "asso",
    "re",
    "cavallo",
    "fante",
    "sette",
    "sei",
    "cinque",
    "quattro",
  ];

  const strengthMap = Object.fromEntries(
    strengthOrder.map((value, index) => [value, strengthOrder.length - index])
  );

  const firstSuit = playedCards[0].suit;

  const winningCard = playedCards.reduce((best, current) => {
    const bestIsBriscola = best.suit === briscolaSuit;
    const currentIsBriscola = current.suit === briscolaSuit;

    if (bestIsBriscola && !currentIsBriscola) return best;
    if (!bestIsBriscola && currentIsBriscola) return current;

    // Entrambe briscole o nessuna
    if (best.suit === current.suit) {
      const bestStrength = strengthMap[best.value];
      const currentStrength = strengthMap[current.value];
      return currentStrength > bestStrength ? current : best;
    }

    // Seme diverso, nessuna è briscola
    if (best.suit === firstSuit) return best;
    if (current.suit === firstSuit) return current;

    return best;
  });

  return winningCard.playerId;
}
