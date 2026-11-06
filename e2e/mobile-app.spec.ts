import { expect, test, type Page } from "@playwright/test";

test.use({ hasTouch: true, viewport: { width: 568, height: 320 }, actionTimeout: 10_000 });

async function register(page: Page, username: string) {
  await page.goto("/");
  await page.getByTestId("open-auth-button").click();
  await page.getByTestId("toggle-auth-mode").click();
  await page.getByTestId("username-input").fill(username);
  await page.getByTestId("password-input").fill("mobile-browser-test");
  await page.getByTestId("auth-submit-button").click();
  await expect(page.getByTestId("auth-dialog")).toBeHidden();
}

async function expectAppViewport(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth > innerWidth,
    vertical: document.documentElement.scrollHeight > innerHeight,
  }))).toEqual({ horizontal: false, vertical: false });
  for (const button of await page.locator(".arcade-header button:visible").all()) {
    const bounds = await button.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    await expect(button).toBeInViewport({ ratio: 1 });
  }
}

test("actual account and pages use the landscape shell without demo data", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await register(page, `mobile_${Date.now().toString(36)}`);
  for (const [width, height] of [[568, 320], [667, 375], [844, 390], [1024, 768]]) {
    await page.setViewportSize({ width, height });
    for (const [route, heading] of [
      ["/", "LA PRESA È TUA."],
      ["/?view=rooms", "Le tue stanze"],
      ["/profile", "Il mio profilo"],
      ["/leaderboard", "Classifica generale"],
      ["/practice", "Allenati contro i bot"],
      ["/annotate", "Raccolta dati esperti"],
      ["/missing-mobile-page", "404"],
    ]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expectAppViewport(page);
      if (route === "/") {
        await expect(page.locator(".club-fan svg[data-landing-card]")).toHaveCount(5);
        for (const id of ["create-room-button", "practice-button", "room-code-input", "join-by-code-button"]) {
          await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
        }
      }
      if (route === "/practice") await expect(page.getByTestId("start-practice-forte")).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: test.info().outputPath(`${route.replaceAll(/[^a-z]/g, "") || "home"}-${width}x${height}.png`) });
    }
  }
  await page.goto("/");
  await page.getByRole("button", { name: "Menu account" }).click();
  await page.getByRole("menuitem", { name: "Esci", exact: true }).click();
  await expect(page.getByTestId("open-auth-button")).toBeVisible();
  await page.getByTestId("open-auth-button").click();
  await expect(page.getByTestId("auth-submit-button")).toBeInViewport({ ratio: 1 });
  await page.getByTestId("username-input").fill("account-inesistente");
  await page.getByTestId("password-input").fill("password-non-valida");
  await page.getByTestId("auth-submit-button").click();
  await expect(page.getByTestId("auth-dialog")).toBeVisible();
  await expect(page.getByText("Invalid credentials")).toBeVisible();
});

test("four real mobile sessions join, rotate, synchronize and play a trick", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const contexts = await Promise.all(Array.from({ length: 4 }, () =>
    browser.newContext({ baseURL, hasTouch: true, viewport: { width: 568, height: 320 }, reducedMotion: "reduce" }),
  ));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const names = pages.map((_, index) => `touch${index}_${Date.now().toString(36)}`);
  try {
    await contexts[0].addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined }));
    for (const [index, page] of pages.entries()) await register(page, names[index]);
    await pages[0].getByTestId("create-room-button").click();
    await expect(pages[0]).toHaveURL(/\/room\/[^/]+$/);
    const code = new URL(pages[0].url()).pathname.split("/").at(-1)!;
    await pages[0].getByRole("button", { name: "Condividi link" }).click();
    await expect(pages[0].getByLabel("Link di invito")).toHaveValue(`${baseURL}/room/${code}`);
    await pages[0].getByRole("button", { name: "Chiudi", exact: true }).click();
    for (const page of pages.slice(1)) {
      await page.getByTestId("room-code-input").fill(code.toLowerCase());
      await page.getByTestId("join-by-code-button").click();
      await expect(page).toHaveURL(`/room/${code}`);
    }
    for (const page of pages) await expect(page.getByText("Giocatori: 4 / 4")).toBeVisible();
    for (const [index, page] of pages.entries()) {
      await page.getByTestId(`team-${index % 2}-button`).click();
      await expect(page.getByTestId("team-0-button")).toHaveCount(0);
      await expect(page.getByTestId("ready-button")).toBeEnabled();
      await expect(page.getByTestId("ready-button")).toBeInViewport({ ratio: 1 });
      await expectAppViewport(page);
    }
    await pages[0].screenshot({ path: test.info().outputPath("real-waiting-room-568x320.png") });
    const departures: string[] = [];
    pages[0].on("request", (request) => { if (request.url().endsWith(`/rooms/${code}/leave`)) departures.push(request.url()); });
    await pages[0].getByTestId("ready-button").click();
    await expect(pages[1].locator(".arcade-waiting-player").filter({ hasText: names[0] }).getByText("Pronto", { exact: true })).toBeVisible();
    await pages[0].setViewportSize({ width: 320, height: 568 });
    const orientation = pages[0].getByRole("dialog", { name: "Gira il telefono" });
    await expect(orientation).toBeVisible();
    await pages[0].keyboard.press("Escape");
    await expect(orientation).toBeVisible();
    await expect(pages[0].getByRole("button", { name: "Continua in verticale" })).toHaveCount(0);
    await pages[0].setViewportSize({ width: 568, height: 320 });
    await expect(orientation).toBeHidden();
    await expect(pages[0].getByTestId("ready-button")).toHaveText("Non pronto");
    expect(departures).toEqual([]);
    for (const page of pages.slice(1)) await page.getByTestId("ready-button").click();
    for (const page of pages) {
      await expect(page).toHaveURL(`/game/${code}`);
      await expect(page.getByTestId("player-hand").getByRole("button")).toHaveCount(10);
    }
    const callerIndex = (await Promise.all(pages.map((page) => page.getByTestId("hand-card-denara-quattro").count()))).findIndex(Boolean);
    expect(callerIndex).toBeGreaterThanOrEqual(0);
    await pages[callerIndex].getByTestId("suit-button-denara").click();
    for (let turn = 0; turn < 4; turn++) {
      let active = -1;
      await expect.poll(async () => {
        active = (await Promise.all(pages.map((page) => page.locator('[data-playable="true"]').count()))).findIndex(Boolean);
        return active;
      }).toBeGreaterThanOrEqual(0);
      const card = pages[active].locator('[data-playable="true"]').first();
      const id = await card.getAttribute("data-testid");
      await card.click();
      if (turn === 0) await pages[active].getByTestId("signal-button-none").click();
      await expect(pages[active].getByTestId(id!)).toHaveCount(0);
    }
    for (const page of pages) await expect(page.getByTestId("player-hand").getByRole("button")).toHaveCount(9);
    await pages[0].screenshot({ path: test.info().outputPath("real-first-trick-568x320.png") });
    await expect(pages[0].getByTestId("game-table-center").locator('[data-testid^="card-"]')).toHaveCount(0, { timeout: 6_000 });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("real trained bots play, and practice can pause, resume and abandon", async ({ page }) => {
  await register(page, `botmobile_${Date.now().toString(36)}`);
  await page.getByTestId("practice-button").click();
  await page.getByTestId("start-practice-forte").click();
  await expect(page).toHaveURL(/\/game\/[^/]+$/);
  const code = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect(page.getByTestId("player-hand").getByRole("button")).toHaveCount(10);
  if (await page.getByTestId("hand-card-denara-quattro").count()) {
    await page.getByTestId("suit-button-denara").click();
  }
  const playable = page.locator('[data-playable="true"]').first();
  await expect(playable).toBeVisible({ timeout: 20_000 });
  const leads = await page.getByTestId("game-table-center").locator('[data-testid^="card-"]').count() === 0;
  await playable.click();
  if (leads) await page.getByTestId("signal-button-none").click();
  await expect(page.getByTestId("player-hand").getByRole("button")).toHaveCount(9);
  const tools = page.locator(".arcade-game-tools");
  await tools.getByTestId("pause-practice-button").click();
  await expect(page).toHaveURL("/");
  await page.getByRole("button", { name: "Tavoli", exact: true }).click();
  const paused = page.getByRole("heading", { name: "Allenamenti in pausa" }).locator("..");
  await expect(paused.getByText(code, { exact: true })).toBeVisible();
  await paused.getByRole("button", { name: "Riprendi", exact: true }).click();
  await expect(page).toHaveURL(`/game/${code}`);
  await page.reload();
  await expect(page.getByTestId("player-hand").getByRole("button")).toHaveCount(9);
  await tools.getByTestId("abandon-practice-button").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Abbandona", exact: true }).click();
  await expect(page).toHaveURL("/");
  await page.getByRole("button", { name: "Tavoli", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Allenamenti in pausa" })).toHaveCount(0);
});
