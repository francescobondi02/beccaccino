import type {
  AnnotationCard,
  AnnotationPlayCardAction,
  AnnotationPlayCardScenario,
  AnnotationSeat,
  AnnotationSignal,
} from "@/annotations/model";
import type { HistoryTrick } from "@/components/TrickHistoryDialog";

export type RelativePosition = "bottom" | "left" | "top" | "right";
export type SignalChoice = AnnotationSignal | undefined;

export function relativePosition(
  seat: AnnotationSeat,
  actingSeat: AnnotationSeat,
): RelativePosition {
  return (["bottom", "left", "top", "right"] as const)[
    (seat - actingSeat + 4) % 4
  ];
}

export function seatLabel(
  seat: AnnotationSeat,
  actingSeat: AnnotationSeat,
): string {
  const position = relativePosition(seat, actingSeat);
  if (position === "bottom") return "Tu";
  if (position === "top") return "Socio";
  if (position === "left") return "Sinistra";
  return "Destra";
}

export function scoreLabel(raw: number): string {
  const points = Math.floor(raw / 3);
  const figures = raw % 3;
  return `${points} ${points === 1 ? "punto" : "punti"} + ${figures} ${
    figures === 1 ? "figura" : "figure"
  }`;
}

export function cardKey(card: AnnotationCard): string {
  return `${card.suit}:${card.value}`;
}

export function actionMatchesCard(
  action: AnnotationPlayCardAction,
  card: AnnotationCard,
): boolean {
  return action.suit === card.suit && action.value === card.value;
}

export function formatSignal(signal: AnnotationSignal): string {
  if (!signal) return "Nessun segnale";
  return signal.charAt(0).toUpperCase() + signal.slice(1);
}

export function historyFor(
  scenario: AnnotationPlayCardScenario,
): HistoryTrick[] {
  const completed = scenario.completedTricks.map((trick) => ({
    number: trick.number,
    winnerLabel: seatLabel(trick.winnerSeat, scenario.actingSeat),
    plays: trick.plays.map((play) => ({
      label: seatLabel(play.seat, scenario.actingSeat),
      suit: play.suit,
      value: play.value,
      signal: play.position === 0 && trick.signal ? trick.signal : null,
    })),
  }));
  if (scenario.currentTrick.plays.length === 0) return completed;

  return [
    ...completed,
    {
      number: scenario.currentTrick.number,
      current: true,
      plays: scenario.currentTrick.plays.map((play) => ({
        label: seatLabel(play.seat, scenario.actingSeat),
        suit: play.suit,
        value: play.value,
        signal:
          play.position === 0 && scenario.currentTrick.signal
            ? scenario.currentTrick.signal
            : null,
      })),
    },
  ];
}
