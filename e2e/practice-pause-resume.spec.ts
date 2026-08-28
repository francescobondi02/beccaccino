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

  const practice = await api.post("/api/rooms/practice", {
    data: { tier: "facile" },
  });
  expect(practice.ok()).toBe(true);
  const { code } = (await practice.json()) as { code: string };
  expect(code).toBeTruthy();

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
    await page.goto(`/game/${code}`);
    await expect(page.getByTestId("game-table-page")).toBeVisible();
    await expect(page.getByText("Riconnessione in corso...")).toHaveCount(0, {
      timeout: 10_000,
    });
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

    await page.setViewportSize({ width: 390, height: 844 });
    const horizontalOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath("paused-direct-mobile.png"),
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
