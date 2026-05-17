import { test, expect } from "./helpers/fixtures";
import { BotPlayer } from "./helpers/BotPlayer";

/**
 * E2E test: Game flow after start.
 *
 * Verifies that after game starts:
 * 1. The caller sees the briscola dialog and can choose
 * 2. Players can take turns playing cards
 * 3. A complete hand (4 cards) is played successfully
 *
 * Requires backend with GAME_WIN_POINTS=12 in .env and
 * rate limiting disabled in development mode.
 */
test.describe("Full Game", () => {
  test("players can choose briscola and play a complete hand", async ({
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
    }

    // Wait for sockets to stabilize
    await players[0].page.waitForTimeout(2000);

    // --- Verify briscola selection ---
    let briscolaChosen = false;
    for (let attempt = 0; attempt < 10 && !briscolaChosen; attempt++) {
      for (const player of players) {
        if (await player.hasTrumpDialog()) {
          await player.chooseTrumpSuit("denara");
          briscolaChosen = true;
          break;
        }
      }
      if (!briscolaChosen) {
        await players[0].page.waitForTimeout(1000);
      }
    }
    expect(briscolaChosen).toBe(true);

    // Wait for briscola to propagate
    await players[0].page.waitForTimeout(1000);

    for (const player of players) {
      const briscola = await player.getBriscola();
      expect(briscola).toBe("denara");
    }

    // --- Play first hand (4 cards) ---
    let cardsPlayed = 0;
    for (let turn = 0; turn < 4; turn++) {
      let activePlayer: BotPlayer | null = null;
      for (let attempt = 0; attempt < 30; attempt++) {
        for (const player of players) {
          try {
            if (await player.isMyTurn()) {
              activePlayer = player;
              break;
            }
          } catch {
            // ignore
          }
        }
        if (activePlayer) break;
        await players[0].page.waitForTimeout(500);
      }

      expect(activePlayer).not.toBeNull();
      await activePlayer!.playFirstAvailableCard();
      cardsPlayed++;
    }

    expect(cardsPlayed).toBe(4);

    // Verify the hand completed — 4 cards on the table
    const tableCards = players[0].page
      .getByTestId("game-table-center")
      .locator('[data-testid^="card-"]');
    const tableCardCount = await tableCards.count();
    expect(tableCardCount).toBe(4);
  });
});
