import {
  CARD_SIGNALS,
  isCardSignal,
  isSuit,
  isValue,
  SUITS,
  VALUES,
} from "../../src/domain/cards";

describe("card domain values", () => {
  it("accepts every Prisma suit and value", () => {
    expect(SUITS).toHaveLength(4);
    expect(VALUES).toHaveLength(10);
    expect(SUITS.every(isSuit)).toBe(true);
    expect(VALUES.every(isValue)).toBe(true);
  });

  it("rejects values outside the card enums", () => {
    expect(isSuit("clubs")).toBe(false);
    expect(isSuit(null)).toBe(false);
    expect(isValue("jack")).toBe(false);
    expect(isValue(3)).toBe(false);
  });

  it("accepts only supported card signals", () => {
    expect(CARD_SIGNALS.every(isCardSignal)).toBe(true);
    expect(isCardSignal("passo")).toBe(false);
    expect(isCardSignal(null)).toBe(false);
  });
});
