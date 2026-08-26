import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "./helpers/fixtures";

const execFileAsync = promisify(execFile);
const backendRoot = resolve(process.cwd(), "../backend");
const testDatabaseUrl =
  "postgresql://postgres:postgres@localhost:5432/becca_test";

test.beforeAll(async () => {
  await execFileAsync(
    resolve(backendRoot, "node_modules/.bin/ts-node"),
    ["tests/helpers/seedAnnotationE2e.ts"],
    {
      cwd: backendRoot,
      env: {
        ...process.env,
        DATABASE_URL: testDatabaseUrl,
        DIRECT_URL: testDatabaseUrl,
      },
    },
  );
});

async function verifyVisualState(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  const brokenImages = await page.locator("img").evaluateAll((images) =>
    images
      .filter((image) => !image.complete || image.naturalWidth === 0)
      .map((image) => image.getAttribute("src")),
  );
  expect(brokenImages).toEqual([]);

  const horizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath(`annotation-${name}.png`),
    fullPage: false,
  });
}

test("invited expert submits account-linked scenario decisions", async ({
  createBot,
}, testInfo) => {
  const suffix = Date.now().toString().slice(-10);
  const expert = await createBot(`expert${suffix}`);

  await expert.register();
  await expert.page.goto("/annotate");
  await expert.page.getByLabel("Codice").fill("codice-errato");
  await expert.page.getByRole("button", { name: "Continua" }).click();
  await expect(expert.page.getByText("Codice non valido.")).toBeVisible();
  await expect(expert.page.getByText("Codice esperto")).toBeVisible();

  await expert.page.getByLabel("Codice").fill("becca-expert");
  await expert.page.getByRole("button", { name: "Continua" }).click();

  await expect(expert.page.getByText("0 risposte inviate")).toBeVisible();
  const legalCard = expert.page
    .locator('button[aria-label^="Seleziona"]:not([disabled])')
    .first();
  await legalCard.click();
  if (
    await expert.page
      .getByTestId("annotation-signal-choice")
      .isVisible()
  ) {
    await expert.page.getByRole("button", { name: "Niente" }).click();
  }

  await verifyVisualState(expert.page, testInfo, "desktop");
  await expert.page.setViewportSize({ width: 390, height: 844 });
  await verifyVisualState(expert.page, testInfo, "mobile");

  const saved = expert.page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/annotations/responses") &&
      response.request().method() === "POST",
  );
  await expert.page
    .getByRole("button", { name: "Conferma scelta" })
    .click();
  await expert.page.getByRole("button", { name: "Media" }).click();
  await expert.page.getByRole("button", { name: "Invia risposta" }).click();
  expect((await saved).ok()).toBe(true);

  await expect(expert.page.getByText("Risposta salvata.")).toBeVisible();
  await expect(expert.page.getByText("1 risposta inviata")).toBeVisible();
  await expert.page.reload();
  await expect(expert.page.getByText("1 risposta inviata")).toBeVisible();

  await expert.page.setViewportSize({ width: 1280, height: 720 });
  await expert.page.getByRole("button", { name: "Non sono sicuro" }).click();
  await expert.page
    .getByLabel("Perché non sei sicuro?")
    .fill("Non ricordo se il tre è già uscito.");
  await expert.page.waitForTimeout(250);
  await verifyVisualState(expert.page, testInfo, "comment-desktop");
  await expert.page.setViewportSize({ width: 390, height: 844 });
  await verifyVisualState(expert.page, testInfo, "comment-mobile");
  await expert.page.getByRole("button", { name: "Continua" }).click();
  await expert.page.getByRole("button", { name: "Difficile" }).click();
  const skipped = expert.page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/annotations/responses") &&
      response.request().method() === "POST",
  );
  await expert.page.getByRole("button", { name: "Invia risposta" }).click();
  const skippedResponse = await skipped;
  expect(skippedResponse.ok()).toBe(true);
  expect(skippedResponse.request().postDataJSON()).toEqual(
    expect.objectContaining({
      selectedAction: null,
      skipped: true,
      comment: "Non ricordo se il tre è già uscito.",
      perceivedDifficulty: "hard",
    }),
  );
  await expect(expert.page.getByText("2 risposte inviate")).toBeVisible();
});
