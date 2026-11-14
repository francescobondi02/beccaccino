import { roundDealTimes } from "../../src/gameConfig";

describe("round dealing presentation", () => {
  it("reserves distribution and reading time before the first briscola", () => {
    expect(roundDealTimes({ number: 1, createdAt: new Date(1000) }).reviewEndsAt).toBe(5000);
  });

  it("shows a four-second summary before dealing the next round", () => {
    expect(roundDealTimes({ number: 2, createdAt: new Date(1000) })).toEqual({
      summaryEndsAt: 5000,
      animationEndsAt: 7400,
      reviewEndsAt: 9000,
    });
  });
});
