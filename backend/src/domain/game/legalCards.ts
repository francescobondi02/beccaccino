type SuitedCard = { suit: string };

export function selectLegalCards<T extends SuitedCard>(
  cards: readonly T[],
  leadSuit: string | null,
): T[] {
  if (leadSuit === null) return [...cards];
  const followingSuit = cards.filter((card) => card.suit === leadSuit);
  return followingSuit.length > 0 ? followingSuit : [...cards];
}

export function isLegalCard<T extends SuitedCard>(
  cards: readonly T[],
  selected: T,
  leadSuit: string | null,
): boolean {
  return selectLegalCards(cards, leadSuit).includes(selected);
}
