import { test, expect } from "@playwright/test";

test.use({ hasTouch: true, screen: { width: 390, height: 844 } });

test.describe("Mobile preview", () => {
    test("keeps home and waiting-room actions in the landscape viewport", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const apiRequests: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
      });

      for (const [width, height] of [[568, 320], [667, 375], [844, 390], [932, 430], [1024, 768], [1440, 900]]) {
        await page.setViewportSize({ width, height });
        await page.goto("/preview/mobile");
        await expect(page.getByRole("heading", { name: "LA PRESA È TUA." })).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const checkViewport = async () => {
          expect(await page.evaluate(() => {
            const controls = [...document.querySelectorAll(".mobile-preview button, .mobile-preview input, .mobile-preview select, .mobile-preview a")];
            return controls.filter((element) => {
              const rect = element.getBoundingClientRect();
              if (!rect.width || !rect.height) return false;
              return rect.x < 0 || rect.y < 0 || rect.right > innerWidth || rect.bottom > innerHeight || rect.width < 44 || rect.height < 44;
            }).map((element) => element.getAttribute("aria-label") || element.textContent?.trim());
          }), `${width}x${height}`).toEqual([]);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
          expect(await page.evaluate(() => {
            const title = document.querySelector(".mobile-lobby-art h1");
            if (title) {
              const bottom = title.getBoundingClientRect().bottom;
              return title.scrollWidth > title.clientWidth ||
                [...document.querySelectorAll(".mobile-art-card")].some((card) => card.getBoundingClientRect().top < bottom);
            }
            return [...document.querySelectorAll(".mobile-room-player")].some((player) => {
              const bounds = player.getBoundingClientRect();
              const team = player.closest(".mobile-team")!.getBoundingClientRect();
              return bounds.top < team.top || bounds.bottom > team.bottom;
            });
          }), `Content overlaps at ${width}x${height}`).toBe(false);
        };
        await checkViewport();
        await page.screenshot({ path: test.info().outputPath(`home-${width}x${height}.png`) });
        await page.getByRole("button", { name: "Crea stanza", exact: true }).click();
        await expect(page.getByRole("button", { name: "Sono pronto", exact: true })).toBeVisible();
        await checkViewport();
        await page.screenshot({ path: test.info().outputPath(`room-${width}x${height}.png`) });
      }
      expect(apiRequests).toEqual([]);
    });

    test("validates invitations and resets ready when team or bots change", async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await page.goto("/preview/mobile");
      await page.getByRole("button", { name: "Ho un codice", exact: true }).click();
      const input = page.getByLabel("Codice stanza", { exact: true });
      await input.fill("ab");
      await page.getByRole("button", { name: "Entra nella stanza" }).click();
      await expect(page).toHaveURL(/\/preview\/mobile$/);
      expect(await input.evaluate((element: HTMLInputElement) => element.validity.patternMismatch)).toBe(true);
      await page.getByRole("button", { name: "BECCA, torna alla home mobile", exact: true }).click();
      await expect(page.getByRole("button", { name: "Crea stanza", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Ho un codice", exact: true }).click();
      await input.fill("abc123");
      await expect(input).toHaveValue("ABC123");
      await input.press("Enter");
      await expect(page).toHaveURL(/\/preview\/mobile\/room$/);
      await expect(page.locator(".mobile-room-code")).toHaveText("ABC123");
      await page.getByRole("button", { name: "Sono pronto", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("Un posto è ancora libero");
      await page.getByRole("button", { name: "Scegli squadra 1" }).click();
      await expect(page.getByRole("button", { name: "Non sono pronto", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Scegli squadra 2" }).click();
      await expect(page.getByRole("button", { name: "Scegli squadra 2" })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: "Sono pronto", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Sono pronto", exact: true }).click();
      await page.getByLabel("Completa il posto libero").selectOption("forte");
      await expect(page.getByRole("button", { name: "Sono pronto", exact: true })).toBeVisible();
      await expect(page.getByText("Bot alla partenza", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Sono pronto", exact: true }).click();
      await page.getByRole("button", { name: "Entra nel tavolo demo", exact: true }).click();
      await expect(page.getByTestId("player-hand").getByRole("button")).toHaveCount(10);
      await page.getByRole("button", { name: "Tutti i tavoli", exact: true }).click();
      await expect(page).toHaveURL(/\/preview\/mobile$/);
      await page.getByRole("button", { name: "Allenamento", exact: false }).click();
      await page.getByRole("button", { name: "Prova contro i bot", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Scalda la mano." })).toBeVisible();
      await page.getByRole("button", { name: "Gioca nel tavolo demo", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Allenamento demo · Tavolo demo" })).toBeAttached();
    });

    test("blocks portrait without dismissing or losing the selected mode", async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      await page.goto("/preview/mobile");
      await page.getByRole("button", { name: "Allenamento", exact: false }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      const prompt = page.getByRole("dialog", { name: "Gira il telefono" });
      await expect(prompt).toBeVisible();
      await expect(page.getByRole("button", { name: "Continua in verticale" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Prova contro i bot", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(prompt).toBeVisible();
      await page.setViewportSize({ width: 768, height: 1024 });
      await expect(prompt).toBeVisible();
      await page.setViewportSize({ width: 844, height: 390 });
      await expect(prompt).toBeHidden();
      await expect(page.getByRole("button", { name: "Prova contro i bot", exact: true })).toBeVisible();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(page.locator(".mobile-preview-main")).toHaveCSS("animation-name", "none");
      await page.getByRole("button", { name: "Come si gioca", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Tre dritte. Poi si gioca." })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Come si gioca", exact: true })).toBeFocused();
    });

    test("keeps all landscape pages inside the app shell with visible primary actions", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const requests: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url());
      });
      for (const [width, height] of [[568, 320], [667, 375], [844, 390], [1024, 768]]) {
        await page.setViewportSize({ width, height });
        for (const route of ["lobby", "practice", "leaderboard", "profile", "account", "result", "missing"]) {
          await page.goto(`/preview/mobile/${route}`);
          await expect(page.locator(".mobile-preview h1")).toBeVisible();
          expect(await page.evaluate(() => {
            const root = document.documentElement;
            return root.scrollHeight <= innerHeight && root.scrollWidth <= innerWidth;
          }), `${route}: ${width}x${height}`).toBe(true);
          const action = page.locator(".mobile-page-action, .mobile-result main > div > button");
          await expect(action).toBeVisible();
          expect(await action.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width >= 44 && rect.height >= 44 && rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
          }), `${route}: primary action ${width}x${height}`).toBe(true);
          expect(await page.evaluate(() => [...document.querySelectorAll(".mobile-header-tools a, .mobile-header-tools button, .mobile-section-intro nav a")].some((element) => {
            const rect = element.getBoundingClientRect();
            return rect.top < 0 || rect.bottom > innerHeight || rect.left < 0 || rect.right > innerWidth || rect.width < 44 || rect.height < 44;
          })), `${route}: navigation ${width}x${height}`).toBe(false);
          await page.screenshot({ path: test.info().outputPath(`${route}-${width}x${height}.png`) });
        }
      }
      expect(requests).toEqual([]);
    });

    test("connects SVG home, rooms, account and profile without using real APIs", async ({ page }) => {
      await page.setViewportSize({ width: 844, height: 390 });
      const requests: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url());
      });
      await page.goto("/preview/mobile");
      await expect(page.locator(".mobile-card-fan svg[data-landing-card]")).toHaveCount(3);
      await expect(page.locator(".mobile-card-fan img")).toHaveCount(0);
      await page.getByRole("link", { name: "Tavoli aperti", exact: true }).click();
      await page.getByRole("button", { name: "Entra: Il socio ti aspetta.", exact: true }).click();
      await expect(page.locator(".mobile-room-code")).toHaveText("SOCIO1");
      await page.getByRole("link", { name: "Profilo demo di Alex", exact: true }).click();
      await page.getByLabel("Nome giocatore").fill("Giulia");
      await page.getByRole("button", { name: "Salva", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("solo nella demo");
      await page.getByRole("button", { name: "BECCA, torna alla home mobile", exact: true }).click();
      await page.getByRole("button", { name: "Crea stanza", exact: true }).click();
      await expect(page.getByText("Giulia (tu)", { exact: true })).toHaveCount(1);
      await page.getByRole("link", { name: "Profilo demo di Giulia", exact: true }).click();
      await page.getByRole("button", { name: "Esci dalla demo", exact: true }).click();
      await expect(page.getByRole("link", { name: "Accedi alla demo", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Non hai un account? Registrati", exact: true }).click();
      await page.getByLabel("Nome utente demo", { exact: true }).fill("Sara");
      await page.getByLabel("Password demo", { exact: true }).fill("demo");
      await page.getByRole("button", { name: "Crea profilo demo", exact: true }).click();
      await expect(page).toHaveURL(/\/account$/);
      await page.getByLabel("Password demo", { exact: true }).fill("demo123");
      await page.getByRole("button", { name: "Crea profilo demo", exact: true }).click();
      await expect(page.getByLabel("Nome giocatore")).toHaveValue("Sara");
      await page.locator(".mobile-header-tools").getByRole("link", { name: "Classifica", exact: true }).click();
      await expect(page.getByText("Sara (tu)", { exact: true })).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByRole("dialog", { name: "Gira il telefono" })).toBeVisible();
      await page.setViewportSize({ width: 844, height: 390 });
      await expect(page.getByText("Sara (tu)", { exact: true })).toBeVisible();
      expect(requests).toEqual([]);
    });

    test("fits the mobile table and connects a complete trick to results", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      for (const [width, height] of [[568, 320], [667, 375], [844, 390]]) {
        await page.setViewportSize({ width, height });
        await page.goto("/preview/mobile/table");
        await expect(page.getByTestId("player-hand").getByRole("button")).toHaveCount(10);
        expect(await page.evaluate(() => [...document.querySelectorAll(".club-match-controls button, [data-testid='player-hand'] button")].filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width < 44 || rect.height < 44 || rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight;
        }).map((element) => element.textContent?.trim() || element.getAttribute("aria-label"))), `${width}x${height}`).toEqual([]);
        await page.getByTestId("player-hand").getByRole("button").first().click();
        await page.getByTestId("signal-button-none").click();
        await page.getByRole("button", { name: "Completa la presa", exact: true }).click();
        await expect(page.locator("[data-card-user-id]")).toHaveCount(4);
        await page.screenshot({ path: test.info().outputPath(`table-${width}x${height}.png`) });
        await page.getByRole("button", { name: "Risultato demo", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Vittoria!", exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Premi della partita", exact: true })).toBeAttached();
        await page.getByRole("button", { name: "Torna alla lobby", exact: true }).click();
        await expect(page).toHaveURL(/\/preview\/mobile$/);
      }
    });
});
