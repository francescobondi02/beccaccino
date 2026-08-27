// The real Italian deck in public/images/cards is the visual identity of V2.
export const CARD_VALUES = [
  "asso",
  "due",
  "tre",
  "quattro",
  "cinque",
  "sei",
  "sette",
  "fante",
  "cavallo",
  "re",
] as const;

export const CARD_SUITS = ["bastoni", "coppe", "denari", "spade"] as const;

export type CardValue = (typeof CARD_VALUES)[number];
export type CardSuit = (typeof CARD_SUITS)[number];

export const CARD_FILENAMES: string[] = CARD_VALUES.flatMap((value) =>
  CARD_SUITS.map((suit) => `${value}_${suit}.png`),
);

export function cardSrc(filename: string): string {
  return `/images/cards/${filename}`;
}

/** Deterministic-enough shuffle for decorative fans. */
export function pickCards(count: number, offset = 0): string[] {
  const picked: string[] = [];
  for (let i = 0; i < count; i += 1) {
    picked.push(CARD_FILENAMES[(i * 7 + offset * 3) % CARD_FILENAMES.length]);
  }
  return picked;
}
