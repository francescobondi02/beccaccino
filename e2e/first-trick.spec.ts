import { test, expect } from "./helpers/fixtures";
import { BotPlayer } from "./helpers/BotPlayer";

/**
 * E2E test: Game flow after start.
 *
 * Verifies that after game starts:
 * 1. The caller sees the briscola dialog and can choose
 * 2. Players can take turns playing cards
 * 3. The first trick (4 cards) is played successfully
 *
 * Requires rate limiting to be disabled in development mode.
 */
test.describe("First Trick", () => {
  test("players can choose briscola and play the first trick", async ({
    createBot,
  }) => {
    test.setTimeout(90_000);

    const suffix = Date.now().toString(36);
    const alice = await createBot(`Alice_${suffix}`);
    const bob = await createBot(`Bob_${suffix}`);
    const carol = await createBot(`Carol_${suffix}`);
    const dave = await createBot(`Dave_${suffix}`);
    const players = [alice, bob, carol, dave];

    // --- Setup ---
    for (const player of players) {
      await player.register();
    }

    const roomCode = await alice.createRoom();

    for (const player of [bob, carol, dave]) {
      await player.page.goto("/");
      await player.joinRoomByCode(roomCode);
    }

    await alice.chooseTeam(0);
    await carol.chooseTeam(0);
    await bob.chooseTeam(1);
    await dave.chooseTeam(1);

    for (const player of players) {
      await player.setReady();
    }

    for (const player of players) {
      await player.waitForGameStart();
      await player.waitForGameTableLoad();
      await expect(
        player.page.locator(
          '[data-testid="player-hand"] [data-testid^="hand-card-"]',
        ),
      ).toHaveCount(10);
    }

    // --- Verify briscola selection ---
    const callerMatches = await Promise.all(
      players.map((player) =>
        player.page.getByTestId("hand-card-denara-quattro").count(),
      ),
    );
    expect(callerMatches.reduce((total, count) => total + count, 0)).toBe(1);
    const caller = players[callerMatches.findIndex((count) => count === 1)];
    await caller.chooseTrumpSuit("denara");

    for (const player of players) {
      await expect(player.page.getByTestId("game-table-page")).toHaveAttribute(
        "data-briscola",
        "denara",
      );
    }

    // --- Play first trick (4 cards) ---
    let cardsPlayed = 0;
    for (let turn = 0; turn < 4; turn++) {
      let activePlayerIndex = -1;
      await expect
        .poll(
          async () => {
            const turnStates = await Promise.all(
              players.map((player) => player.isMyTurn()),
            );
            activePlayerIndex = turnStates.findIndex(Boolean);
            return activePlayerIndex;
          },
          {
            message: `waiting for the player taking turn ${turn + 1}`,
            timeout: 15_000,
          },
        )
        .toBeGreaterThanOrEqual(0);

      const activePlayer: BotPlayer = players[activePlayerIndex];
      await activePlayer.playFirstAvailableCard();
      cardsPlayed++;
    }

    expect(cardsPlayed).toBe(4);

    // Verify the trick completed — 4 cards on the table
    const tableCards = players[0].page
      .getByTestId("game-table-center")
      .locator('[data-testid^="card-"]');
    await expect(tableCards).toHaveCount(4);
    await players[0].page.waitForTimeout(1_000);
    await expect(tableCards).toHaveCount(4);
    await expect(tableCards).toHaveCount(0, { timeout: 5_000 });
  });
});
