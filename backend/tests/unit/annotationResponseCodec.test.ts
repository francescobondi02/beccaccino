import {
  actionToAnnotationColumns,
  annotationColumnsToAction,
} from "../../src/annotations/responseCodec";
import { AnnotationSelectedAction } from "../../src/annotations/contracts";
import {
  CardSignal,
  SUITS,
  VALUES,
} from "../../src/domain/game/cards";

const signals: readonly (CardSignal | null)[] = [
  null,
  "striscio",
  "busso",
  "volo",
];
const actions: AnnotationSelectedAction[] = [
  ...SUITS.flatMap((suit) =>
    VALUES.flatMap((value) =>
      signals.map(
        (signal): AnnotationSelectedAction => ({
          decisionType: "play_card",
          suit,
          value,
          signal,
        }),
      ),
    ),
  ),
  ...SUITS.map(
    (suit): AnnotationSelectedAction => ({
      decisionType: "choose_briscola",
      suit,
    }),
  ),
];

describe("annotation response codec", () => {
  it.each(actions)("round-trips $decisionType %#", (action) => {
    expect(
      annotationColumnsToAction({
        decisionType: action.decisionType,
        skipped: false,
        columns: actionToAnnotationColumns(action),
      }),
    ).toEqual(action);
  });

  it("round-trips a skipped response as empty columns", () => {
    const columns = actionToAnnotationColumns(null);

    expect(columns).toEqual({
      selectedSuit: null,
      selectedValue: null,
      selectedSignal: null,
      selectedBriscola: null,
    });
    expect(
      annotationColumnsToAction({
        decisionType: "play_card",
        skipped: true,
        columns,
      }),
    ).toBeNull();
  });

  it("rejects mixed or invalid database columns", () => {
    expect(() =>
      annotationColumnsToAction({
        decisionType: "play_card",
        skipped: false,
        columns: {
          selectedSuit: "denara",
          selectedValue: "asso",
          selectedSignal: null,
          selectedBriscola: "coppe",
        },
      }),
    ).toThrow(/mismatched/);
    expect(() =>
      annotationColumnsToAction({
        decisionType: "play_card",
        skipped: false,
        columns: {
          selectedSuit: "denara",
          selectedValue: "asso",
          selectedSignal: "invalid",
          selectedBriscola: null,
        },
      }),
    ).toThrow(/invalid selected signal/);
    expect(() =>
      annotationColumnsToAction({
        decisionType: "choose_briscola",
        skipped: true,
        columns: {
          selectedSuit: null,
          selectedValue: null,
          selectedSignal: null,
          selectedBriscola: "coppe",
        },
      }),
    ).toThrow(/skipped annotation/);
  });
});
