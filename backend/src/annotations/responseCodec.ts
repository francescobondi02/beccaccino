import { Suit, Value } from "../domain/game/cards";
import { parseAnnotationSelectedAction } from "./action";
import {
  AnnotationDecisionType,
  AnnotationSelectedAction,
} from "./contracts";

export type AnnotationActionColumns = {
  selectedSuit: Suit | null;
  selectedValue: Value | null;
  selectedSignal: string | null;
  selectedBriscola: Suit | null;
};

const EMPTY_ACTION_COLUMNS: AnnotationActionColumns = {
  selectedSuit: null,
  selectedValue: null,
  selectedSignal: null,
  selectedBriscola: null,
};

export function actionToAnnotationColumns(
  action: AnnotationSelectedAction | null,
): AnnotationActionColumns {
  if (!action) return { ...EMPTY_ACTION_COLUMNS };
  if (action.decisionType === "choose_briscola") {
    return {
      ...EMPTY_ACTION_COLUMNS,
      selectedBriscola: action.suit,
    };
  }
  return {
    selectedSuit: action.suit,
    selectedValue: action.value,
    selectedSignal: action.signal,
    selectedBriscola: null,
  };
}

export function annotationColumnsToAction(args: {
  decisionType: AnnotationDecisionType;
  skipped: boolean;
  columns: AnnotationActionColumns;
}): AnnotationSelectedAction | null {
  const {
    selectedSuit,
    selectedValue,
    selectedSignal,
    selectedBriscola,
  } = args.columns;
  if (args.skipped) {
    if (
      selectedSuit !== null ||
      selectedValue !== null ||
      selectedSignal !== null ||
      selectedBriscola !== null
    ) {
      throw new Error("skipped annotation selects an action");
    }
    return null;
  }

  if (args.decisionType === "choose_briscola") {
    if (
      selectedBriscola === null ||
      selectedSuit !== null ||
      selectedValue !== null ||
      selectedSignal !== null
    ) {
      throw new Error(
        "briscola annotation contains mismatched selected action columns",
      );
    }
    return parseAnnotationSelectedAction({
      decisionType: "choose_briscola",
      suit: selectedBriscola,
    });
  }

  if (
    selectedSuit === null ||
    selectedValue === null ||
    selectedBriscola !== null
  ) {
    throw new Error(
      "card annotation contains mismatched selected action columns",
    );
  }
  try {
    return parseAnnotationSelectedAction({
      decisionType: "play_card",
      suit: selectedSuit,
      value: selectedValue,
      signal: selectedSignal,
    });
  } catch {
    throw new Error("annotation contains an invalid selected signal");
  }
}
