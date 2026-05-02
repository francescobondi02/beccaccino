import {
  clearDatabase,
  setupGame,
  chooseBriscola,
  oneRound,
  computeRoundPoints,
  prepareNextRound,
} from "../helpers/gameHelpers";

// Game service ends the game at 5 points in test mode (see gameService.ts).
// Since each round produces 11 total points, one team always gets ≥6, so the
// game always ends after exactly one round under this threshold.
const WINNING_SCORE = 5;

beforeEach(async () => {
  await clearDatabase();
});

describe("Full Beccaccino game", () => {
  it("plays until one team reaches the winning score and round totals always equal 11", async () => {
    const { roomCode, round: firstRound, cards } = await setupGame();

    let team0Total = 0;
    let team1Total = 0;
    let roundCount = 0;
    let currentRound = firstRound;
    let currentCards = cards;

    while (team0Total < WINNING_SCORE && team1Total < WINNING_SCORE) {
      roundCount++;
      await chooseBriscola(roomCode, currentRound, currentCards);
      await oneRound(roomCode, currentRound);

      ({ team0Total, team1Total } = await computeRoundPoints(
        currentRound.id,
        roundCount,
        team0Total,
        team1Total
      ));

      if (team0Total < WINNING_SCORE && team1Total < WINNING_SCORE) {
        ({ nextRound: currentRound, nextCards: currentCards } =
          await prepareNextRound(currentRound));
      }
    }

    expect(team0Total >= WINNING_SCORE || team1Total >= WINNING_SCORE).toBe(true);
  });
});
