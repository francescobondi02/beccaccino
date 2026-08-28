import { Suit, Value } from "./cards";

/**
 * Detect "Cricca": the briscola caller holds Tre + Due + Asso
 * of the chosen briscola suit.
 *
 * @param callerCards All cards in the caller's hand for this round
 * @param briscolaSuit The suit chosen as briscola
 * @returns true if the caller has cricca
 */
export function detectCricca(
  callerCards: { suit: Suit; value: Value }[],
  briscolaSuit: Suit,
): boolean {
  const required: Value[] = ["tre", "due", "asso"];
  return required.every((v) =>
    callerCards.some((c) => c.suit === briscolaSuit && c.value === v),
  );
}
