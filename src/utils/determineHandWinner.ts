import { Suit, Value } from "@prisma/client";

export function determineHandWinner(
  playedCards: { playerId: number; suit: Suit; value: Value }[],
  briscolaSuit: Suit | null
): number {
  if (playedCards.length === 0) throw new Error("No cards played");

  //^ DA SCRIVERE LA LOGICA DI DETERMINAZIONE VINCITORE MANO

  return 0;
}
