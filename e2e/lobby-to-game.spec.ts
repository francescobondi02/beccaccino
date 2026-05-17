import { test, expect } from "./helpers/fixtures";

/**
 * E2E test: 4 players register → create room → join → choose teams → ready → game starts.
 *
 * This test verifies the complete pre-game flow using 4 independent browser contexts,
 * each representing a different player with their own session.
 */
test.describe("Lobby to Game Start", () => {
  test("4 players can register, form a room, pick teams, and start a game", async ({
    createBot,
  }) => {
    // Create 4 players with unique names (timestamp avoids collisions across runs)
    const suffix = Date.now().toString(36);
    const alice = await createBot(`Alice_${suffix}`);
    const bob = await createBot(`Bob_${suffix}`);
    const carol = await createBot(`Carol_${suffix}`);
    const dave = await createBot(`Dave_${suffix}`);
    const players = [alice, bob, carol, dave];

    // Step 1: All players register
    for (const player of players) {
      await player.register();
    }

    // Step 2: Alice creates the room
    const roomCode = await alice.createRoom();
    expect(roomCode).toBeTruthy();
    expect(roomCode.length).toBeGreaterThanOrEqual(6);

    // Step 3: Other players join via code
    for (const player of [bob, carol, dave]) {
      // Navigate back to lobby first
      await player.page.goto("/");
      await player.joinRoomByCode(roomCode);
    }

    // Step 4: All players should see the room page
    for (const player of players) {
      await expect(player.page.getByTestId("room-code-display")).toBeVisible();
    }

    // Step 5: Choose teams — Alice+Carol = Team 0, Bob+Dave = Team 1
    await alice.chooseTeam(0);
    await carol.chooseTeam(0);
    await bob.chooseTeam(1);
    await dave.chooseTeam(1);

    // Step 6: All players ready up
    for (const player of players) {
      await player.setReady();
    }

    // Step 7: Game should start — all players navigate to /game/:code
    for (const player of players) {
      await player.waitForGameStart();
    }

    // Step 8: Verify game table loaded for all
    for (const player of players) {
      await player.waitForGameTableLoad();
    }

    // Wait for game state to fully load (cards dealt)
    await players[0].page.waitForTimeout(2000);

    // Verify each player has 10 cards dealt
    for (const player of players) {
      const cardCount = await player.getHandCardCount();
      expect(cardCount).toBe(10);
    }
  });
});
