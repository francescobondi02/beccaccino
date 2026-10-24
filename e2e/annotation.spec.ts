import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "./helpers/fixtures";

const execFileAsync = promisify(execFile);
const backendRoot = resolve(process.cwd(), "../backend");
const testDatabaseUrl =
  process.env.E2E_DATABASE_URL ??
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

async function selectFirstLegalAction(
  page: Page,
): Promise<"play_card" | "choose_briscola"> {
  await expect(
    page.getByRole("button", { name: "Conferma scelta" }),
  ).toBeVisible();

  const legalCard = page
    .locator('button[aria-label^="Seleziona"]:not([disabled])')
    .first();
  if ((await legalCard.count()) > 0) {
    await legalCard.click();
    const signalChoice = page.getByTestId("annotation-signal-choice");
    if (await signalChoice.isVisible()) {
      await signalChoice.locator("button:not([disabled])").first().click();
    }
    return "play_card";
  }

  const legalBriscola = page.locator(
    'button[role="radio"]:not([disabled])',
  ).first();
  await expect(legalBriscola).toBeVisible();
  await legalBriscola.click();
  return "choose_briscola";
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
  const selectedDecisionType = await selectFirstLegalAction(expert.page);

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
  const savedResponse = await saved;
  expect(savedResponse.ok()).toBe(true);
  expect(savedResponse.request().postDataJSON()).toEqual(
    expect.objectContaining({
      selectedAction: expect.objectContaining({
        decisionType: selectedDecisionType,
      }),
      skipped: false,
    }),
  );

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

test("expert selects and submits a briscola scenario", async ({
  createBot,
}, testInfo) => {
  const suffix = Date.now().toString().slice(-10);
  const expert = await createBot(`briscola${suffix}`);
  const scenario = {
    id: 9001,
    code: "e2e-choose-briscola",
    stateHash: "e2e-choose-briscola-hash",
    decisionType: "choose_briscola",
    targetPoints: 41,
    roundNumber: 3,
    actingSeat: 0,
    callerSeat: 0,
    totalScores: { 0: 12, 1: 9 },
    hand: [
      { suit: "coppe", value: "asso" },
      { suit: "spade", value: "tre" },
      { suit: "denara", value: "sette" },
      { suit: "bastoni", value: "re" },
      { suit: "coppe", value: "due" },
      { suit: "spade", value: "quattro" },
      { suit: "denara", value: "cinque" },
      { suit: "bastoni", value: "sei" },
      { suit: "coppe", value: "fante" },
      { suit: "spade", value: "cavallo" },
    ],
    legalActions: ["denara", "coppe", "spade", "bastoni"],
  };
  let nextCalls = 0;

  await expert.register();
  await expert.page.route("**/api/annotations/status", (route) =>
    route.fulfill({
      json: { accessGranted: true, contributionCount: 0 },
    }),
  );
  await expert.page.route("**/api/annotations/next", (route) => {
    nextCalls += 1;
    return route.fulfill({
      json:
        nextCalls === 1
          ? { scenario, contributionCount: 0 }
          : { scenario: null, contributionCount: 1 },
    });
  });
  await expert.page.route("**/api/annotations/responses", (route) =>
    route.fulfill({ json: { contributionCount: 1 } }),
  );

  await expert.page.goto("/annotate");
  await expect(
    expert.page.getByRole("radio", { name: /come briscola$/ }),
  ).toHaveCount(4);
  await expect(expert.page.getByText("Presa in corso")).toHaveCount(0);
  await expect(
    expert.page.getByRole("button", { name: "Apri storico della smazzata" }),
  ).toHaveCount(0);
  await verifyVisualState(expert.page, testInfo, "briscola-desktop");
  await expert.page.setViewportSize({ width: 390, height: 844 });
  await verifyVisualState(expert.page, testInfo, "briscola-mobile");

  await expert.page
    .getByRole("radio", { name: "Scegli Coppe come briscola" })
    .click();
  await expert.page
    .getByRole("button", { name: "Conferma scelta" })
    .click();
  await expert.page.getByRole("button", { name: "Facile" }).click();
  await expert.page.getByRole("button", { name: "Invia risposta" }).click();

  await expect(expert.page.getByText("Risposta salvata.")).toBeVisible();
  await expect(expert.page.getByText("1 risposta inviata")).toBeVisible();
});
