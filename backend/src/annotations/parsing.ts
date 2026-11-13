import {
  CardSignal,
  isCardSignal,
  isSuit,
  isValue,
} from "../domain/game/cards";
import {
  AnnotationCard,
  AnnotationDecisionType,
  AnnotationSeat,
} from "./contracts";
import { exactKeys, integerAt, recordAt } from "../utils/json";

export function isAnnotationDecisionType(
  value: unknown,
): value is AnnotationDecisionType {
  return value === "play_card" || value === "choose_briscola";
}

export function seatAt(value: unknown, path: string): AnnotationSeat {
  return integerAt(value, path, 0, 3) as AnnotationSeat;
}

export function nonEmptyStringAt(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

export function signalAt(value: unknown, path: string): CardSignal | null {
  if (value === null) return null;
  if (!isCardSignal(value)) {
    throw new Error(`${path} must be striscio, busso, volo, or null`);
  }
  return value;
}

export function cardAt(value: unknown, path: string): AnnotationCard {
  const record = recordAt(value, path);
  exactKeys(record, ["suit", "value"], path);
  if (!isSuit(record.suit)) throw new Error(`${path}.suit is invalid`);
  if (!isValue(record.value)) throw new Error(`${path}.value is invalid`);
  return { suit: record.suit, value: record.value };
}

export function cardKey(card: AnnotationCard): string {
  return `${card.suit}:${card.value}`;
}
