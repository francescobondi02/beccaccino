import {
  difficultySelectionOrder,
  emptyDifficultyCounts,
} from "../../src/annotations/selection";

describe("annotation scenario selection", () => {
  it("starts at medium and then corrects the 20/40/40 user mix", () => {
    expect(difficultySelectionOrder(emptyDifficultyCounts())).toEqual([
      "medium",
      "hard",
      "easy",
    ]);
    expect(
      difficultySelectionOrder({ easy: 0, medium: 1, hard: 0 })[0],
    ).toBe("hard");
    expect(
      difficultySelectionOrder({ easy: 0, medium: 1, hard: 1 })[0],
    ).toBe("easy");
  });

});
