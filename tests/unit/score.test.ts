import { cumulativeScore, decideGameWinner } from "../../src/utils/score";

const row = (
  team0Points: number,
  team1Points: number,
  team0Figures: number,
  team1Figures: number,
) => ({ team0Points, team1Points, team0Figures, team1Figures });

describe("cumulativeScore", () => {
  it("carries figure remainders into whole points across rounds", () => {
    // Two rounds of 2 figures each = 4 raw = 1 real point + 1 figure.
    // Summing only the points columns would report 0.
    const total = cumulativeScore([row(0, 0, 2, 0), row(0, 0, 2, 0)]);
    expect(total.team0).toEqual({ points: 1, figures: 1 });
    expect(total.team1).toEqual({ points: 0, figures: 0 });
  });
});

describe("decideGameWinner", () => {
  it("detects a win that exists only once carried figures are counted", () => {
    // Whole points alone sum to 13 (< 14). The 2+1 figures = 3 raw = +1 point
    // lift team0 to exactly 14, so the win is visible only via figures.
    const total = cumulativeScore([row(13, 0, 2, 0), row(0, 0, 1, 0)]);
    expect(total.team0.points).toBe(14);
    expect(decideGameWinner(total, 14, 0)).toBe(0);
    expect(decideGameWinner(total, 15, 0)).toBeNull();
  });

  it("gives an exact both-cross tie to the caller's team", () => {
    const total = cumulativeScore([row(5, 5, 0, 0)]);
    expect(decideGameWinner(total, 5, 1)).toBe(1);
    expect(decideGameWinner(total, 5, 0)).toBe(0);
  });

  it("awards a both-cross round to the higher score regardless of caller", () => {
    const total = cumulativeScore([row(6, 5, 0, 0)]);
    expect(decideGameWinner(total, 5, 1)).toBe(0);
  });

  it("returns null until a team reaches the threshold", () => {
    const total = cumulativeScore([row(3, 2, 0, 0)]);
    expect(decideGameWinner(total, 5, 0)).toBeNull();
  });
});
