import {
  clearDatabase,
  setupGame,
  chooseBriscola,
  oneRound,
} from "../helpers/gameHelpers";

beforeEach(async () => {
  await clearDatabase();
});

describe("Game flow", () => {
  it("sets up a game, chooses briscola, and plays a full round", async () => {
    const { roomCode, round, cards } = await setupGame();
    await chooseBriscola(roomCode, round, cards);
    await oneRound(roomCode, round);
  });
});
