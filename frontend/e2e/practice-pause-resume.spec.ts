import { expect, test } from "@playwright/test";

const apiURL = process.env.E2E_API_URL ?? "http://localhost:8000";

test("practice game can be paused, resumed, and abandoned", async ({
  browser,
  playwright,
}, testInfo) => {
  const username = `pause${Date.now().toString().slice(-10)}`;
  const api = await playwright.request.newContext({ baseURL: apiURL });
  const registration = await api.post("/api/users/register", {
    data: { username, password: "browser-test-password" },
  });
  expect(registration.ok()).toBe(true);

  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const browserErrors: string[] = [];
  const failedResponses: string[] = [];

  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  const pauseButton = page.locator(
    '[data-testid="pause-practice-button"]:visible',
  );
  const pausedHeading = page.getByRole("heading", {
    name: "Allenamenti in pausa",
  });

  try {
    await page.goto("/practice");
    await expect(page.getByRole("heading", { name: "Bot allenato" })).toBeVisible();
    await expect(page.getByTestId("start-practice-facile")).toHaveCount(0);
    await page.getByTestId("start-practice-forte").click();
    await expect(page).toHaveURL(/\/game\/[^/]+$/);
    const code = new URL(page.url()).pathname.split("/").at(-1)!;
    await expect(page.getByTestId("game-table-page")).toBeVisible();
    await expect(page.getByTestId("open-practice-history")).toHaveCount(0);
    await expect(page.getByTestId("toggle-reveal-hands")).toHaveCount(0);
    await expect(page.getByText("Riconnessione in corso...")).toHaveCount(0, {
      timeout: 10_000,
    });
    const briscola = page.getByTestId("suit-button-denara");
    if (await briscola.isVisible()) await briscola.click();
    await page.locator('[data-testid="player-hand"] button[data-playable="true"]')
      .first().click({ timeout: 15_000 });
    const noSignal = page.getByTestId("signal-button-none");
    const tableTools = page.locator(".arcade-game-tools");
    if (await noSignal.isVisible()) {
      await expect(page.getByText("Briscola scelta: denari")).toHaveCount(0);
      const signalDialog = page.getByRole("dialog", {
        name: "Vuoi dichiarare qualcosa?",
      });
      await expect(signalDialog.getByTestId("pause-practice-button")).toHaveCount(0);
      await expect(signalDialog.getByTestId("abandon-practice-button")).toHaveCount(0);
      for (const width of [1440]) {
        await page.setViewportSize({ width, height: 844 });
        await tableTools.getByTestId("pause-practice-button").click({
          trial: true,
          timeout: 5_000,
        });
        await tableTools.getByTestId("abandon-practice-button").click({
          trial: true,
          timeout: 5_000,
        });
      }
      await noSignal.click();
    }
    await expect(tableTools.getByTestId("pause-practice-button"))
      .toBeInViewport({ ratio: 1 });
    await expect(tableTools.getByTestId("abandon-practice-button"))
      .toBeInViewport({ ratio: 1 });
    const tableCards = page.getByTestId("game-table-center")
      .locator('[data-testid^="table-card-position-"]');
    await expect(tableCards).toHaveCount(4);
    const previousCards = await tableCards.getByAltText(/ di /).evaluateAll(
      (images) => images.map((image) => image.getAttribute("alt")).sort(),
    );
    await page.waitForTimeout(1_000);
    await expect(tableCards).toHaveCount(4);
    await expect(tableCards).toHaveCount(0, { timeout: 5_000 });
    await tableTools.getByRole("button", { name: "Ultima presa" }).click();
    const lastTrick = page.getByRole("dialog", { name: "Ultima presa" });
    await expect(lastTrick.getByAltText(/ di /)).toHaveCount(4);
    expect(await lastTrick.getByAltText(/ di /).evaluateAll(
      (images) => images.map((image) => image.getAttribute("alt")).sort(),
    )).toEqual(previousCards);
    await lastTrick.getByRole("button", { name: "Chiudi" }).click();
    await expect(pauseButton.first()).toBeVisible();

    await pauseButton.first().click();
    await expect(page).toHaveURL("/");
    await expect(pausedHeading).toBeVisible();
    await expect(page.getByText(code, { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("paused-home-desktop.png"),
      fullPage: true,
    });

    const pausedSection = pausedHeading.locator("..");
    await pausedSection.getByRole("button", { name: "Riprendi" }).click();
    await expect(page).toHaveURL(`/game/${code}`);
    await expect(page.getByTestId("game-table-page")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Allenamento in pausa" }),
    ).toHaveCount(0);

    for (const width of [1440]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(tableTools.getByTestId("pause-practice-button"))
        .toBeInViewport({ ratio: 1 });
      await expect(tableTools.getByTestId("abandon-practice-button"))
        .toBeInViewport({ ratio: 1 });
      const seatBounds = await page.getByTestId("player-seat-bottom").boundingBox();
      const toolsBounds = await tableTools.boundingBox();
      expect(seatBounds).not.toBeNull();
      expect(toolsBounds).not.toBeNull();
      const controlsGap = toolsBounds!.y - (seatBounds!.y + seatBounds!.height);
      expect(controlsGap).toBeGreaterThanOrEqual(4);
      expect(controlsGap).toBeLessThanOrEqual(20);
    }
    await page.screenshot({
      path: testInfo.outputPath("practice-controls.png"),
      fullPage: true,
    });
    await expect(pauseButton.first()).toBeVisible();
    await pauseButton.first().click();
    await expect(page).toHaveURL("/");
    await expect(pausedHeading).toBeVisible();

    await page.goto(`/game/${code}`);
    const pausedDialog = page.getByRole("alertdialog");
    await expect(pausedDialog).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Allenamento in pausa" }),
    ).toBeVisible();
    await expect(
      pausedDialog.getByRole("button", { name: "Riprendi" }),
    ).toBeVisible();
    await expect(
      pausedDialog.getByRole("button", {
        name: "Abbandona",
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("paused-direct-desktop.png"),
    });

    await pausedDialog
      .getByRole("button", { name: "Abbandona", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Abbandonare l'allenamento?" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Abbandona definitivamente" })
      .click();
    await expect(page).toHaveURL("/");
    await expect(page.getByText(code, { exact: true })).toHaveCount(0);

    expect(browserErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
  } finally {
    await context.close();
    await api.dispose();
  }
});
