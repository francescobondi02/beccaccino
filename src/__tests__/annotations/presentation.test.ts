import { describe, expect, it } from "vitest";
import type { AnnotationCard } from "@/annotations/model";
import {
  actionMatchesCard,
  cardKey,
  relativePosition,
  scoreLabel,
  seatLabel,
} from "@/annotations/presentation";

describe("annotation presentation rules", () => {
  it.each([
    { seat: 2 as const, actingSeat: 2 as const, position: "bottom", label: "Tu" },
    { seat: 3 as const, actingSeat: 2 as const, position: "left", label: "Sinistra" },
    { seat: 0 as const, actingSeat: 2 as const, position: "top", label: "Socio" },
    { seat: 1 as const, actingSeat: 2 as const, position: "right", label: "Destra" },
  ])(
    "rotates seat $seat to $position for acting seat $actingSeat",
    ({ seat, actingSeat, position, label }) => {
      expect(relativePosition(seat, actingSeat)).toBe(position);
      expect(seatLabel(seat, actingSeat)).toBe(label);
    },
  );

  it.each([
    { raw: 0, label: "0 punti + 0 figure" },
    { raw: 4, label: "1 punto + 1 figura" },
    { raw: 8, label: "2 punti + 2 figure" },
  ])("formats raw score $raw", ({ raw, label }) => {
    expect(scoreLabel(raw)).toBe(label);
  });

  it("uses one card identity rule for keys and legal actions", () => {
    const card: AnnotationCard = { suit: "coppe", value: "asso" };

    expect(cardKey(card)).toBe("coppe:asso");
    expect(
      actionMatchesCard({ ...card, signal: null }, card),
    ).toBe(true);
    expect(
      actionMatchesCard({ suit: "spade", value: "asso", signal: null }, card),
    ).toBe(false);
  });
});
