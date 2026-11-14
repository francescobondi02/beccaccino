export type Suit = "denara" | "coppe" | "spade" | "bastoni";
export type CardValue =
  | "asso"
  | "due"
  | "tre"
  | "quattro"
  | "cinque"
  | "sei"
  | "sette"
  | "fante"
  | "cavallo"
  | "re";
// A card is unique by suit and value.
export type Card = { suit: Suit; value: CardValue };
export type Signal = "striscio" | "busso" | "volo";
export type Team = 0 | 1;
export type BotTier = "facile" | "medio" | "forte" | "esperto";
