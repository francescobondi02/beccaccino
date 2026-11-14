import { test, expect } from "./helpers/fixtures";

// Needs the backend started with GAME_WIN_POINTS=5 so one or two rounds finish the game.
test("4 players play a full game to the result page", async ({ createBot }) => {
  test.setTimeout(600_000);
  const suffix = Date.now().toString(36);
  const players = await Promise.all(
    ["Alice", "Bob", "Carol", "Dave"].map((name) => createBot(`${name}_${suffix}`)),
  );
  const [alice, bob, carol, dave] = players;
  for (const player of players) await player.register();

  const roomCode = await alice.createRoom();
  for (const player of [bob, carol, dave]) {
    await player.page.goto("/");
    await player.joinRoomByCode(roomCode);
  }
  await alice.chooseTeam(0);
  await carol.chooseTeam(0);
  await bob.chooseTeam(1);
  await dave.chooseTeam(1);
  for (const player of players) await player.setReady();
  for (const player of players) await player.waitForGameTableLoad();

  const finished = alice.page.getByTestId("game-result-page");
  while (!(await finished.isVisible())) {
    for (const player of players) {
      const suit = player.page.locator('[data-testid^="suit-button-"]').first();
      if (await suit.isVisible()) await suit.click();
      else if (await player.isMyTurn()) await player.playFirstAvailableCard();
    }
    await alice.page.waitForTimeout(200);
  }
  for (const player of players) {
    await expect(player.page.getByTestId("game-result-page")).toBeVisible();
  }
});
