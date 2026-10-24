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
    await alice.page.setViewportSize({ width: 320, height: 900 });
    expect(await alice.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await alice.page.screenshot({ path: test.info().outputPath("arcade-waiting-room-320.png"), fullPage: true });

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

    // Verify each player has 10 cards dealt
    for (const player of players) {
      await expect(
        player.page.locator(
          '[data-testid="player-hand"] [data-testid^="hand-card-"]',
        ),
      ).toHaveCount(10);
    }

    const callers = await Promise.all(
      players.map((player) => player.page.getByTestId("hand-card-denara-quattro").count()),
    );
    await players[callers.findIndex(Boolean)].chooseTrumpSuit("denara");
    for (const width of [320, 390, 768, 1440]) {
      await alice.page.setViewportSize({ width, height: 900 });
      await expect(alice.page.getByTestId("game-table-page")).toHaveAttribute("data-briscola", "denara");
      await expect(alice.page.getByRole("dialog")).toHaveCount(0);
      expect(await alice.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(alice.page.getByTestId("player-hand")).toBeVisible();
      if (width <= 768) {
        const hand = await alice.page.getByTestId("player-hand").boundingBox();
        const arena = await alice.page.locator(".arcade-arena").boundingBox();
        expect(hand?.height).toBeLessThanOrEqual(240);
        expect(arena?.height).toBeGreaterThanOrEqual(300);
      }
      if (width < 640) {
        await expect(alice.page.locator(".arcade-mobile-trump")).toHaveText("Briscola: denari");
        await expect(alice.page.locator(".arcade-mobile-trump")).toBeVisible();
        const message = await alice.page.locator('[data-testid="game-table-center"] > .text-center').boundingBox();
        const leftSeat = await alice.page.getByTestId("player-position-left").boundingBox();
        const rightSeat = await alice.page.getByTestId("player-position-right").boundingBox();
        expect(message?.x).toBeGreaterThanOrEqual((leftSeat?.x ?? 0) + (leftSeat?.width ?? 0));
        expect((message?.x ?? 0) + (message?.width ?? 0)).toBeLessThanOrEqual(rightSeat?.x ?? 0);
      }
      await alice.page.screenshot({ path: test.info().outputPath(`arcade-game-${width}.png`), fullPage: true });
    }
  });
});
