import { roundDealRemainingMs } from "../../src/gameConfig";

describe("round dealing presentation", () => {
  it("reserves distribution and reading time before the first briscola", () => {
    expect(roundDealRemainingMs({ number: 1, createdAt: new Date(1000) }, 1000)).toBe(4000);
  });

  it("shows a four-second summary before dealing the next round", () => {
    expect(roundDealRemainingMs({ number: 2, createdAt: new Date(1000) }, 1000)).toBe(8000);
    expect(roundDealRemainingMs({ number: 2, createdAt: new Date(1000) }, 5000)).toBe(4000);
  });

  it("does not restart the presentation after reconnect or runtime recovery", () => {
    expect(roundDealRemainingMs({ number: 2, createdAt: new Date(1000) }, 10000)).toBe(0);
  });
});
