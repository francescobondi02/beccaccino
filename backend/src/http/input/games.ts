import {
  CARD_SIGNALS,
  CardSignal,
  isCardSignal,
  isSuit,
  isValue,
  Suit,
  SUITS,
  Value,
  VALUES,
} from "../../domain/game/cards";
import { badRequest } from "../errors";

type Body = Record<string, unknown> | null | undefined;

export function parseSuit(body: Body): Suit {
  const suit = body?.suit;
  if (!isSuit(suit)) {
    throw badRequest(`Invalid suit: "${suit}". Must be one of: ${SUITS.join(", ")}`);
  }
  return suit;
}

export function parsePlayedCard(body: Body): {
  card: { suit: Suit; value: Value };
  signal: CardSignal | null;
} {
  const suit = parseSuit(body);
  const { value, signal = null } = body!;
  if (!isValue(value)) {
    throw badRequest(`Invalid value: "${value}". Must be one of: ${VALUES.join(", ")}`);
  }
  if (signal !== null && !isCardSignal(signal)) {
    throw badRequest(
      `Invalid signal: "${signal}". Must be one of: ${CARD_SIGNALS.join(", ")} (or null)`,
    );
  }
  return { card: { suit, value }, signal };
}
