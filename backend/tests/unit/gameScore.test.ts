import {
  sumRoundScores,
  decideGameWinner,
} from "../../src/domain/game/gameScore";

const row = (team0Raw: number, team1Raw: number) => ({ team0Raw, team1Raw });

describe("sumRoundScores", () => {
  it("carries figure remainders into whole points across rounds", () => {
    // Two rounds of 2 figures each = 4 raw = 1 real point + 1 figure.
    const total = sumRoundScores([row(2, 0), row(2, 0)]);
    expect(total.team0).toEqual({ points: 1, figures: 1 });
    expect(total.team1).toEqual({ points: 0, figures: 0 });
  });
});

describe("decideGameWinner", () => {
  it("detects a win that exists only once carried figures are counted", () => {
    // 41 + 1 raw = 42 raw = 14 points. Whole points per round sum to only 13,
    // so the win is visible only once figures carry over.
    const total = sumRoundScores([row(41, 0), row(1, 0)]);
    expect(total.team0.points).toBe(14);
    expect(decideGameWinner(total, 14, 0)).toBe(0);
    expect(decideGameWinner(total, 15, 0)).toBeNull();
  });

  it("gives an exact both-cross tie to the caller's team", () => {
    const total = sumRoundScores([row(15, 15)]);
    expect(decideGameWinner(total, 5, 1)).toBe(1);
    expect(decideGameWinner(total, 5, 0)).toBe(0);
  });

  it("awards a both-cross round to the higher score regardless of caller", () => {
    const total = sumRoundScores([row(18, 15)]);
    expect(decideGameWinner(total, 5, 1)).toBe(0);
  });

  it("returns null until a team reaches the threshold", () => {
    const total = sumRoundScores([row(9, 6)]);
    expect(decideGameWinner(total, 5, 0)).toBeNull();
  });
});
