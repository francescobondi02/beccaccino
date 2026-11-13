import { Suit, Value } from "@prisma/client";

export { Suit, Value };

export const SUITS = Object.values(Suit);
export const VALUES = Object.values(Value);
export const CARD_SIGNALS = ["striscio", "busso", "volo"] as const;

export type CardSignal = (typeof CARD_SIGNALS)[number];
export type Card = {
  suit: Suit;
  value: Value;
};

export function isSuit(value: unknown): value is Suit {
  return typeof value === "string" && SUITS.some((suit) => suit === value);
}

export function isValue(value: unknown): value is Value {
  return typeof value === "string" && VALUES.some((cardValue) => cardValue === value);
}

export function isCardSignal(value: unknown): value is CardSignal {
  return (
    typeof value === "string" &&
    CARD_SIGNALS.some((signal) => signal === value)
  );
}
