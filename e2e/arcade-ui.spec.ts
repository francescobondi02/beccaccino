import { test, expect } from "./helpers/fixtures";

test.describe("Arcade interface", () => {
  test("defaults to arcade and preserves the classic interface across reloads", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-ui", "arcade");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("NON È SOLO FORTUNA.");
    await expect(page.getByText(/dati demo|tavoli dimostrativi/i)).toHaveCount(0);
    await page.getByRole("button", { name: "Usa interfaccia classica", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Ogni carta");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-ui", "classic");
    await page.getByTestId("open-auth-button").click();
    await expect(page.getByTestId("auth-dialog")).toBeVisible();
    await page.getByRole("button", { name: "Chiudi", exact: true }).click();
    await page.getByRole("button", { name: "Usa nuova interfaccia", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("NON È SOLO FORTUNA.");
  });

  test("keeps rules accessible and lets the user stop decorative motion", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Come si gioca", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("I segnali sono visibili a tutti");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Come si gioca", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Pausa effetti", exact: true }).click();
    await expect(page.locator(".arcade-live-hero")).toHaveAttribute("data-motion", "off");
    await page.getByRole("button", { name: "Attiva effetti", exact: true }).click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(".arcade-live-hero")).toHaveAttribute("data-motion", "off");
  });

  test("fits the real homepage and login dialog on small screens", async ({ page }) => {
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(page.locator(".club-fan-card").last()).toHaveCSS("opacity", "1");
      await page.screenshot({ path: test.info().outputPath(`arcade-home-${width}.png`), fullPage: true });
      await page.getByTestId("open-auth-button").click();
      const dialog = page.getByTestId("auth-dialog");
      await expect(dialog).toBeVisible();
      const bounds = await dialog.boundingBox();
      expect(bounds?.x).toBeGreaterThanOrEqual(0);
      expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width);
      await page.getByRole("button", { name: "Chiudi", exact: true }).click();
    }
  });

  test("keeps profile, rankings, and practice in the new layout", async ({ createBot }) => {
    const player = await createBot(`UI_${Date.now().toString(36)}`);
    await player.register();
    for (const width of [320, 1440]) {
      await player.page.setViewportSize({ width, height: 900 });
      for (const [route, title] of [
        ["/profile", "Il mio profilo"],
        ["/leaderboard", "Classifica generale"],
        ["/practice", "Allenati contro i bot"],
      ]) {
        await player.page.goto(route);
        await expect(player.page.getByRole("heading", { name: title, exact: true })).toBeVisible();
        await expect(player.page.locator("html")).toHaveAttribute("data-ui", "arcade");
        expect(await player.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await player.page.screenshot({ path: test.info().outputPath(`arcade${route.replace("/", "-")}-${width}.png`), fullPage: true });
      }
    }
  });
});
