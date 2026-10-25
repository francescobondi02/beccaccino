import { roundDealPresentation } from "../../src/gameConfig";

describe("round dealing presentation", () => {
  it("reserves distribution and reading time before the first briscola", () => {
    expect(roundDealPresentation({ number: 1, createdAt: new Date(1000) }, 1000))
      .toEqual({ remainingMs: 4000, animationMs: 2400, reviewMs: 1600 });
  });

  it("shows a four-second summary before dealing the next round", () => {
    expect(roundDealPresentation({ number: 2, createdAt: new Date(1000) }, 1000).remainingMs)
      .toBe(8000);
    expect(roundDealPresentation({ number: 2, createdAt: new Date(1000) }, 5000).remainingMs)
      .toBe(4000);
  });

  it("does not restart the presentation after reconnect or runtime recovery", () => {
    expect(roundDealPresentation({ number: 2, createdAt: new Date(1000) }, 10000).remainingMs)
      .toBe(0);
  });
});
