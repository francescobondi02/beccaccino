import { isSuit, isValue } from "../domain/game/cards";
import {
  AnnotationSelectedAction,
  ParsedAnnotationScenario,
} from "./contracts";
import { exactKeys, recordAt, signalAt } from "./parsing";

export function parseAnnotationSelectedAction(
  value: unknown,
): AnnotationSelectedAction {
  const path = "selectedAction";
  const record = recordAt(value, path);
  if (
    record.decisionType === "play_card" ||
    record.decisionType === undefined
  ) {
    exactKeys(
      record,
      record.decisionType === undefined
        ? ["suit", "value", "signal"]
        : ["decisionType", "suit", "value", "signal"],
      path,
    );
    if (!isSuit(record.suit)) throw new Error(`${path}.suit is invalid`);
    if (!isValue(record.value)) throw new Error(`${path}.value is invalid`);
    return {
      decisionType: "play_card",
      suit: record.suit,
      value: record.value,
      signal: signalAt(record.signal, `${path}.signal`),
    };
  }
  if (record.decisionType === "choose_briscola") {
    exactKeys(record, ["decisionType", "suit"], path);
    if (!isSuit(record.suit)) throw new Error(`${path}.suit is invalid`);
    return {
      decisionType: "choose_briscola",
      suit: record.suit,
    };
  }
  throw new Error(`${path}.decisionType is invalid`);
}

export function isAnnotationActionLegal(
  scenario: ParsedAnnotationScenario,
  action: AnnotationSelectedAction,
): boolean {
  if (
    scenario.decisionType === "play_card" &&
    action.decisionType === "play_card"
  ) {
    return scenario.state.legalActions.some(
      (legal) =>
        legal.suit === action.suit &&
        legal.value === action.value &&
        legal.signal === action.signal,
    );
  }
  if (
    scenario.decisionType === "choose_briscola" &&
    action.decisionType === "choose_briscola"
  ) {
    return scenario.state.legalActions.includes(action.suit);
  }
  return false;
}
