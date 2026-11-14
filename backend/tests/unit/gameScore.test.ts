import {
  sumRoundScores,
  decideGameWinner,
  decideScoreWinner,
} from "../../src/domain/game/gameScore";

// Raw score of a round from real points and the figures remainder.
const row = (
  points0: number,
  points1: number,
  figures0: number,
  figures1: number,
) => ({ team0Raw: points0 * 3 + figures0, team1Raw: points1 * 3 + figures1 });

describe("sumRoundScores", () => {
  it("carries figure remainders into whole points across rounds", () => {
    // Two rounds of 2 figures each = 4 raw = 1 real point + 1 figure.
    const total = sumRoundScores([row(0, 0, 2, 0), row(0, 0, 2, 0)]);
    expect(total.team0).toEqual({ points: 1, figures: 1 });
    expect(total.team1).toEqual({ points: 0, figures: 0 });
  });
});

describe("decideGameWinner", () => {
  it("detects a win that exists only once carried figures are counted", () => {
    // Whole points alone sum to 13 (< 14). The 2+1 figures = 3 raw = +1 point
    // lift team0 to exactly 14, so the win is visible only via figures.
    const total = sumRoundScores([row(13, 0, 2, 0), row(0, 0, 1, 0)]);
    expect(total.team0.points).toBe(14);
    expect(decideGameWinner(total, 14, 0)).toBe(0);
    expect(decideGameWinner(total, 15, 0)).toBeNull();
  });

  it("gives an exact both-cross tie to the caller's team", () => {
    const total = sumRoundScores([row(5, 5, 0, 0)]);
    expect(decideGameWinner(total, 5, 1)).toBe(1);
    expect(decideGameWinner(total, 5, 0)).toBe(0);
  });

  it("awards a both-cross round to the higher score regardless of caller", () => {
    const total = sumRoundScores([row(6, 5, 0, 0)]);
    expect(decideGameWinner(total, 5, 1)).toBe(0);
  });

  it("returns null until a team reaches the threshold", () => {
    const total = sumRoundScores([row(3, 2, 0, 0)]);
    expect(decideGameWinner(total, 5, 0)).toBeNull();
  });
});

describe("decideScoreWinner", () => {
  it("uses the caller only for an exact finished-game tie", () => {
    expect(decideScoreWinner(sumRoundScores([row(5, 5, 0, 0)]), 1)).toBe(1);
    expect(decideScoreWinner(sumRoundScores([row(6, 5, 0, 0)]), 1)).toBe(0);
  });
});
