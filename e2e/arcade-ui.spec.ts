import { test, expect } from "./helpers/fixtures";
import type { GameStateResponse } from "../src/game/model";

test.describe("Arcade interface", () => {
  test("shows the round recap before dealing without restarting it on reload", async ({ page }) => {
    const cards = ["asso", "due", "tre", "quattro", "cinque", "sei", "sette", "fante", "cavallo", "re"]
      .map((value, index) => ({ id: 40 + index, suit: "coppe", value, playerId: 10, roundId: 31, inHand: true }));
    await page.route("**/users/me", (route) => route.fulfill({ json: { id: 1, username: "Giulia" } }));
    await page.route("**/rooms/ROOM", (route) => route.fulfill({ json: {
      id: 20, code: "ROOM", started: true, finished: false, isPractice: true,
      players: ["Giulia", "Luca", "Marta", "Diego"].map((username, seat) => ({
        id: 10 + seat, userId: seat + 1, username, seat, team: seat % 2, isReady: true,
      })),
    } }));
    let readyAt = 0;
    await page.route("**/games/ROOM/state", (route) => {
      if (!readyAt) readyAt = Date.now() + 8000;
      const remainingMs = Math.max(0, readyAt - Date.now());
      const state: GameStateResponse = {
        status: "choosing_briscola", pausedAt: null,
        round: { id: 31, number: 2, briscola: null, deal: { remainingMs, animationMs: 2400, reviewMs: 1600 } },
        roundSummary: remainingMs > 4000 ? {
          roundNumber: 1, team0Points: 6, team1Points: 5, team0Figures: 2, team1Figures: 0, winnerTeam: 0,
        } : null,
        callerUserId: 1, currentTurnUserId: 1, currentHandNumber: null,
        myCards: cards, playedCards: [], lastHandCards: [],
        totalPoints: { team0Points: 6, team1Points: 5, team0Figures: 2, team1Figures: 0 },
        turnTimer: null, finishedGame: null, isPractice: true, allHands: null,
      };
      return route.fulfill({ json: state });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/game/ROOM");
    const recap = page.getByRole("dialog", { name: "Smazzata 1 conclusa" });
    await expect(recap).toBeVisible();
    await expect(recap.getByText("Totale: 6 punti · 2 figure")).toBeVisible();
    await expect(recap.getByText("Prossima briscola: Giulia")).toBeVisible();
    await expect(recap.getByRole("button", { name: "Chiudi", exact: true })).toBeHidden();
    await recap.getByTestId("pause-practice-button").click({ trial: true });
    await expect(page.getByTestId("card-deal")).toHaveCount(0);
    await page.reload();
    await expect(recap).toBeVisible();
    await expect(recap).toBeHidden();
    expect(Date.now()).toBeGreaterThanOrEqual(readyAt - 4200);
    await expect(page.getByTestId("card-deal")).toBeAttached();
    await expect(page.getByRole("dialog", { name: "Scegli la briscola" })).toBeVisible();
    expect(Date.now()).toBeGreaterThanOrEqual(readyAt - 200);
    expect(Date.now()).toBeLessThan(readyAt + 1800);
  });

  test("keeps full-page results after reload with optional tied awards", async ({ page }) => {
    const state: GameStateResponse = {
      status: "finished", pausedAt: null,
      round: { id: 30, number: 1, briscola: "spade" },
      callerUserId: 1, currentTurnUserId: null, currentHandNumber: null,
      myCards: [], playedCards: [], lastHandCards: [],
      totalPoints: { team0Points: 7, team1Points: 4, team0Figures: 1, team1Figures: 1 },
      turnTimer: null, isPractice: true, allHands: null,
      finishedGame: {
        winnerTeam: 0, totalRounds: 1, finalScores: { team0: 7, team1: 4 }, roundsWon: { team0: 1, team1: 0 },
        statistics: {
          players: ["Giulia", "Luca", "Marta", "Diego"].map((username, seat) => ({
            playerId: 10 + seat, username, team: seat % 2, tricksWon: seat < 2 ? 5 : 0,
            busso: seat < 2 ? 2 : 0, acesCaptured: seat === 2 ? 2 : 0, acesLost: seat === 1 ? 2 : 0,
          })),
          rounds: [{ number: 1, winnerTeam: 0, team0Points: 7, team1Points: 4, team0Figures: 1, team1Figures: 1 }],
        },
      },
    };
    await page.route("**/users/me", (route) => route.fulfill({ json: { id: 1, username: "Giulia" } }));
    await page.route("**/rooms/ROOM", (route) => route.fulfill({ json: {
      id: 20, code: "ROOM", started: true, finished: true, isPractice: true,
      players: ["Giulia", "Luca", "Marta", "Diego"].map((username, seat) => ({
        id: 10 + seat, userId: seat + 1, username, seat, team: seat % 2, isReady: true,
      })),
    } }));
    await page.route("**/games/ROOM/state", (route) => route.fulfill({ json: state }));
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/game/ROOM");
      await expect(page.getByTestId("game-result-page")).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByText("Giulia, Luca", { exact: true })).toBeVisible();
      await page.getByText("Punteggi delle smazzate", { exact: true }).click();
      await expect(page.getByRole("cell", { name: "7 punti · 1 figure", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Torna alla lobby" }).click({ trial: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.reload();
      await expect(page.getByTestId("game-result-page")).toBeVisible();
      state.finishedGame!.statistics!.players.forEach((player) => {
        player.busso = 0; player.acesCaptured = 0; player.acesLost = 0;
      });
      await page.reload();
      await expect(page.getByRole("heading", { name: "Premi della partita" })).toHaveCount(0);
      state.finishedGame!.statistics!.players[0].busso = 2;
      state.finishedGame!.statistics!.players[1].busso = 2;
    }
  });

  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`deals to four players before trump selection (${reducedMotion})`, async ({ page }) => {
      // REST fixtures have no authenticated Socket.IO session.
      await page.routeWebSocket(/\/socket\.io\//, () => {});
      await page.emulateMedia({ reducedMotion });
      const cards = ["asso", "due", "tre", "quattro", "cinque", "sei", "sette", "fante", "cavallo", "re"]
        .map((value, index) => ({ id: 40 + index, suit: "coppe", value, playerId: 10, roundId: 30, inHand: true }));
      const state: GameStateResponse = {
        status: "choosing_briscola", pausedAt: null,
        round: { id: 30, number: 1, briscola: null },
        callerUserId: 1, currentTurnUserId: 1, currentHandNumber: null,
        myCards: cards, playedCards: [], lastHandCards: [],
        totalPoints: { team0Points: 0, team1Points: 0, team0Figures: 0, team1Figures: 0 },
        turnTimer: null, finishedGame: null, isPractice: true, allHands: null,
      };
      await page.route("**/users/me", (route) => route.fulfill({ json: { id: 1, username: "Giulia" } }));
      await page.route("**/rooms/ROOM", (route) => route.fulfill({ json: {
        id: 20, code: "ROOM", started: true, finished: false, isPractice: true,
        players: ["Giulia", "Luca", "Marta", "Diego"].map((username, seat) => ({
          id: 10 + seat, userId: seat + 1, username, seat, team: seat % 2, isReady: true,
        })),
      } }));
      let readyAt = 0;
      await page.route("**/games/ROOM/state", (route) => {
        if (!readyAt) readyAt = Date.now() + 4000;
        return route.fulfill({ json: {
          ...state,
          round: { ...state.round, deal: { remainingMs: Math.max(0, readyAt - Date.now()), animationMs: 2400, reviewMs: 1600 } },
        } });
      });

      for (const width of [1440, 390]) {
        readyAt = 0;
        await page.setViewportSize({ width, height: 1000 });
        await page.goto("/game/ROOM");
        const trump = page.getByRole("dialog", { name: "Scegli la briscola" });
        await expect(page.getByTestId("card-deal")).toBeAttached();
        await expect(trump).toBeHidden();
        await expect(page.getByTestId("choose-trump-button")).toBeDisabled();
        for (const position of ["bottom", "top", "left", "right"]) {
          await expect(page.locator(`.arcade-dealt-card[data-position="${position}"]`)).toHaveCount(10);
        }
        if (reducedMotion === "reduce") {
          await expect(page.locator(".arcade-dealt-card").first()).toBeHidden();
        }
        await page.getByTestId("pause-practice-button").click({ trial: true });
        await expect(page.getByText("Guarda le tue carte...", { exact: true })).toBeVisible();
        await expect(page.getByTestId("player-hand").getByRole("button")).toHaveCount(10);
        await expect(trump).toBeHidden();
        await page.reload();
        await expect(page.getByTestId("card-deal")).toHaveCount(0);
        await expect(trump).toBeVisible();
        expect(Date.now()).toBeLessThan(readyAt + 1800);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    });
  }

  for (const exit of ["Gioca", "brand", "back", "logout"]) {
    test(`leaves a waiting room through ${exit} without leaving on reload`, async ({ page }) => {
      const departures: string[] = [];
      await page.route("**/users/me", (route) => route.fulfill({ json: { id: 1, username: "Giulia" } }));
      await page.route("**/rooms/available", (route) => route.fulfill({
        json: { availableRooms: [], activeGames: [] },
      }));
      await page.route("**/rooms", (route) => route.fulfill({ json: { code: "ROOM" } }));
      await page.route("**/rooms/ROOM", (route) => route.fulfill({ json: {
        id: 20, code: "ROOM", started: false, finished: false,
        players: [{ id: 10, userId: 1, username: "Giulia", seat: 0, team: 0, isReady: true }],
      } }));
      await page.route("**/rooms/ROOM/leave", (route) => {
        departures.push("leave");
        return route.fulfill({ json: { success: true } });
      });
      await page.route("**/users/logout", (route) => {
        departures.push("logout");
        return route.fulfill({ json: { success: true } });
      });

      await page.goto("/");
      await page.getByTestId("create-room-button").click();
      await expect(page).toHaveURL(/\/room\/ROOM$/);
      await expect(page.getByTestId("ready-button")).toBeVisible();
      await page.reload();
      await expect(page.getByTestId("ready-button")).toBeVisible();
      expect(departures).toEqual([]);

      if (exit === "Gioca") {
        await page.getByRole("button", { name: "Gioca", exact: true }).click();
      } else if (exit === "brand") {
        await page.getByRole("button", { name: "Beccaccino, torna alla lobby" }).click();
      } else if (exit === "back") {
        await page.goBack();
      } else {
        await page.getByRole("button", { name: "Menu account" }).click();
        await page.getByRole("menuitem", { name: "Esci" }).click();
      }
      await expect(page).toHaveURL(/\/$/);
      await expect(page.locator(".arcade-lobby")).toBeVisible();
      await expect.poll(() => departures).toEqual(exit === "logout" ? ["leave", "logout"] : ["leave"]);
    });
  }

  test("keeps the table and hand space fixed after the last card", async ({ page }) => {
    await page.routeWebSocket(/\/socket\.io\//, () => {});
    const card = {
      id: 40, suit: "coppe", value: "asso", playerId: 10, roundId: 30, inHand: true,
    };
    const state: GameStateResponse = {
      status: "playing", pausedAt: null,
      round: { id: 30, number: 1, briscola: "spade" },
      callerUserId: 1, currentTurnUserId: 2, currentHandNumber: 10,
      myCards: [card], playedCards: [], lastHandCards: [],
      totalPoints: { team0Points: 0, team1Points: 0, team0Figures: 0, team1Figures: 0 },
      turnTimer: null, finishedGame: null, isPractice: true, allHands: null,
    };
    await page.route("**/users/me", (route) => route.fulfill({ json: { id: 1, username: "Giulia" } }));
    await page.route("**/rooms/ROOM", (route) => route.fulfill({ json: {
      id: 20, code: "ROOM", started: true, finished: false, isPractice: true,
      players: ["Giulia", "Luca", "Marta", "Diego"].map((username, seat) => ({
        id: 10 + seat, userId: seat + 1, username, seat, team: seat % 2, isReady: true,
      })),
    } }));
    await page.route("**/games/ROOM/state", (route) => route.fulfill({ json: state }));

    for (const viewport of [
      { width: 1920, height: 1080 }, { width: 1280, height: 800 },
      { width: 1024, height: 768 }, { width: 900, height: 900 },
      { width: 768, height: 1024 }, { width: 390, height: 844 },
      { width: 320, height: 780 }, { width: 844, height: 390 },
      { width: 640, height: 360 },
    ]) {
      await page.setViewportSize(viewport);
      state.myCards = [card];
      await page.goto("/game/ROOM");
      const hand = page.getByTestId("player-hand");
      await expect(hand.getByRole("button")).toHaveCount(1);
      await expect(page.locator(".arcade-arena")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const occupied = {
        arena: await page.locator(".arcade-arena").boundingBox(),
        hand: await hand.boundingBox(),
        seat: await page.getByTestId("player-seat-bottom").boundingBox(),
      };
      await page.getByTestId("pause-practice-button").click({ trial: true });
      await page.getByTestId("abandon-practice-button").click({ trial: true });
      const tools = await page.locator(".arcade-game-tools").boundingBox();
      const seat = await page.getByTestId("player-seat-bottom").boundingBox();
      if (!seat || !tools) throw new Error("Missing player seat or practice controls");
      expect.soft(
        seat.x + seat.width <= tools.x ||
        seat.x >= tools.x + tools.width ||
        seat.y + seat.height <= tools.y ||
        seat.y >= tools.y + tools.height,
        `Practice controls cover the player at ${viewport.width}px`,
      ).toBe(true);
      for (const remaining of [[], [{ ...card, inHand: false }]]) {
        state.myCards = remaining;
        await page.reload();
        await expect(page.getByTestId("game-layout")).toBeVisible();
        await expect(hand.getByRole("button")).toHaveCount(0);
        await page.evaluate(() => document.fonts.ready);
        expect.soft(await page.locator(".arcade-arena").boundingBox(), `Table moved at ${viewport.width}px`).toEqual(occupied.arena);
        expect.soft(await hand.boundingBox(), `Hand collapsed at ${viewport.width}px`).toEqual(occupied.hand);
        expect.soft(await page.getByTestId("player-seat-bottom").boundingBox()).toEqual(occupied.seat);
        expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
  });

  test("requires briscola but allows cancelling and changing a leading card", async ({ page }) => {
    const cards = ["asso", "tre"].map((value, index) => ({
      id: 40 + index, suit: "coppe", value, playerId: 10, roundId: 30, inHand: true,
    }));
    const room = {
      id: 20, code: "ROOM", started: true, finished: false, isPractice: false,
      players: ["Giulia", "Luca", "Marta", "Diego"].map((username, seat) => ({
        id: 10 + seat, userId: seat + 1, username, seat, team: seat % 2, isReady: true,
      })),
    };
    let state: GameStateResponse = {
      status: "choosing_briscola", pausedAt: null,
      round: { id: 30, number: 1, briscola: null },
      callerUserId: 1, currentTurnUserId: 1, currentHandNumber: null,
      myCards: cards, playedCards: [], lastHandCards: [],
      totalPoints: { team0Points: 0, team1Points: 0, team0Figures: 0, team1Figures: 0 },
      turnTimer: null, finishedGame: null, isPractice: false, allHands: null,
    };
    const plays: unknown[] = [];
    await page.route("**/users/me", (route) => route.fulfill({ json: { id: 1, username: "Giulia" } }));
    await page.route("**/rooms/ROOM", (route) => route.fulfill({ json: room }));
    await page.route("**/games/ROOM/state", (route) => route.fulfill({ json: state }));
    await page.route("**/games/playable-cards/ROOM", (route) => route.fulfill({ json: { playableCards: cards } }));
    await page.route("**/games/choose-briscola", (route) => {
      state = { ...state, status: "playing", currentHandNumber: 1, round: { ...state.round, briscola: "spade" } };
      return route.fulfill({ json: {} });
    });
    await page.route("**/games/play-card", (route) => {
      plays.push(route.request().postDataJSON());
      return route.fulfill({ json: {} });
    });

    await page.goto("/game/ROOM");
    const trump = page.getByRole("dialog", { name: "Scegli la briscola" });
    await expect(trump).toBeVisible();
    await expect(trump.getByRole("button", { name: "Chiudi" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.mouse.click(8, 8);
    await expect(trump).toBeVisible();
    await trump.getByTestId("suit-button-spade").click();
    await expect(trump).toBeHidden();
    await page.reload();

    const signal = page.getByRole("dialog", { name: "Vuoi dichiarare qualcosa?" });
    await page.getByTestId("hand-card-coppe-asso").click();
    await signal.getByRole("button", { name: "Chiudi" }).click();
    await expect(signal).toBeHidden();
    expect(plays).toHaveLength(0);

    await page.getByTestId("hand-card-coppe-tre").click();
    await signal.getByRole("button", { name: "Niente", exact: true }).click();
    await expect.poll(() => plays).toEqual([
      { roomCode: "ROOM", suit: "coppe", value: "tre", signal: null },
    ]);
  });

  test("uses wide monitors without adding horizontal overflow on mobile", async ({ page }) => {
    await page.route("**/users/me", (route) => route.fulfill({
      status: 401, json: { error: "Not authenticated" },
    }));
    await page.goto("/");
    for (const width of [1920, 2560, 3440, 390, 320]) {
      await page.setViewportSize({ width, height: 1080 });
      for (const selector of [".arcade-header-inner", ".arcade-live-hero .club-main", ".arcade-lounge", ".arcade-bottom-note", ".arcade-lobby > .club-footer"]) {
        const bounds = await page.locator(selector).boundingBox();
        if (!bounds) throw new Error(`Missing home section: ${selector}`);
        expect(bounds.width, `${selector} is capped at ${width}px`).toBeGreaterThanOrEqual(width * .9);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });

  test("keeps account text white while preserving the hover overlay", async ({ page }) => {
    await page.route("**/users/me", (route) => route.fulfill({
      json: { id: 1, username: "Giulia" },
    }));
    await page.route("**/rooms/available", (route) => route.fulfill({
      json: { availableRooms: [], activeGames: [] },
    }));
    await page.setViewportSize({ width: 2560, height: 1080 });
    await page.goto("/");
    const account = page.getByRole("button", { name: "Menu account" });
    const username = page.locator(".arcade-header").getByText("Giulia", { exact: true });
    await expect(username).toBeVisible();
    const foreground = await page.locator("body").evaluate((element) => getComputedStyle(element).color);
    const background = await account.evaluate((element) => getComputedStyle(element).backgroundColor);
    await account.hover();
    await account.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    await expect(username).toHaveCSS("color", foreground);
    await expect(account).not.toHaveCSS("background-color", background);
    await account.click();
    await expect(page.getByText("Il mio account", { exact: true })).toBeVisible();
    await expect(username).toHaveCSS("color", foreground);
  });

  test("previews the dashboard anonymously without loading private statistics", async ({ page }) => {
    await page.route("**/users/me", (route) => route.fulfill({
      status: 401, json: { error: "Not authenticated" },
    }));
    let privateStatsRequests = 0;
    await page.route("**/users/me/stats", (route) => {
      privateStatsRequests += 1;
      return route.fulfill({ status: 401, json: { error: "Not authenticated" } });
    });
    await page.route("**/users/leaderboard", (route) => route.fulfill({
      json: { leaderboard: [] },
    }));
    await page.goto("/preview/profile");
    await expect(page.getByRole("heading", { name: "Il mio profilo", exact: true })).toBeVisible();
    await expect(page.getByText("Anteprima locale · dati dimostrativi · nessun accesso necessario.")).toBeVisible();
    await expect(page.getByText("GiuliaDemo", { exact: true })).toBeVisible();
    await expect(page.locator(".arcade-stat")).toHaveCount(4);
    await expect(page.locator(".arcade-match-row")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Modifica", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Elimina account", exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Torna alla landing" }).click();
    await page.getByRole("contentinfo").getByRole("link", { name: "Classifica" }).click();
    await expect(page.getByRole("heading", { name: "Classifica generale", exact: true })).toBeVisible();
    await page.goto("/profile");
    await expect(page).toHaveURL("/");
    expect(privateStatsRequests).toBe(0);
  });

  test("keeps room borders inside the scroll area while hovering", async ({ page }) => {
    await page.route("**/users/me", (route) => route.fulfill({
      json: { id: 1, username: "Giulia" },
    }));
    await page.route("**/rooms/available", (route) => route.fulfill({
      json: {
        availableRooms: Array.from({ length: 6 }, (_, index) => ({
          id: index + 1, code: `BECCA${index}`, players: [],
        })),
        activeGames: [
          { id: 20, code: "PAUSA1", isPractice: true, pausedAt: "2026-10-24T10:00:00Z", players: [] },
          { id: 21, code: "GIOCO1", isPractice: false, pausedAt: null, players: [] },
        ],
      },
    }));
    await page.goto("/");
    const scroll = page.locator(".arcade-live-rooms .overflow-y-auto");
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const code of ["PAUSA1", "GIOCO1", "BECCA0"]) {
        const card = page.locator(".arcade-room-card").filter({ hasText: code });
        await card.hover();
        await card.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
        const area = await scroll.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return { left: bounds.left, right: bounds.left + element.clientWidth };
        });
        const bounds = await card.boundingBox();
        if (!bounds) throw new Error("Missing hovered room card");
        expect(bounds.x, `Left border clipped at ${width}px`).toBeGreaterThanOrEqual(area.left);
        expect(bounds.x + bounds.width, `Right border clipped at ${width}px`).toBeLessThanOrEqual(area.right);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator(".arcade-live-rooms").screenshot({ path: test.info().outputPath(`room-hover-${width}.png`) });
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator(".arcade-room-card").filter({ hasText: "BECCA0" }).hover();
    await expect(page.locator(".arcade-room-card").filter({ hasText: "BECCA0" })).toHaveCSS("transform", "none");
  });

  test("shows responsive personal stats and ordered rankings with long names", async ({ page }) => {
    await page.route("**/users/me", (route) => route.fulfill({
      json: { id: 1, username: "Giulia" },
    }));
    await page.route("**/users/me/stats", (route) => route.fulfill({
      json: {
        totalGames: 28, wins: 17, winRate: 61, totalPoints: 892,
        recentGames: [
          { id: 1, code: "UNO", date: "2026-10-24T12:00:00Z", result: "Vittoria", myTeamPoints: 41, opponentTeamPoints: 29, teammates: ["Luca"], opponents: ["Marta", "Diego"] },
          { id: 2, code: "DUE", date: "2026-10-23T12:00:00Z", result: "Sconfitta", myTeamPoints: 33, opponentTeamPoints: 42, teammates: ["Giocatore_con_un_nome_molto_lungo"], opponents: ["Francesco", "Giocatore_con_un_nome_molto_lungo"] },
        ],
      },
    }));
    const names = ["Giulia", "Giocatore_con_un_nome_molto_lungo", "Luca", "Marta", "Giocatore_con_un_nome_molto_lungo_2"];
    await page.route("**/users/leaderboard", (route) => route.fulfill({
      json: { leaderboard: names.map((username, index) => ({
        username, wins: 17 - index, totalGames: 28, winRate: 61 - index * 4, totalPoints: 892 - index * 30,
      })) },
    }));
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/profile");
      await expect(page.getByRole("heading", { name: "Il mio profilo", exact: true })).toBeVisible();
      await expect(page.locator(".arcade-stat")).toHaveCount(4);
      await expect(page.locator(".arcade-match-row")).toHaveCount(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`personal-dashboard-${width}.png`), fullPage: true, animations: "disabled" });

      await page.goto("/leaderboard");
      const podium = page.getByRole("list", { name: "Podio", exact: true });
      await expect(podium.getByRole("listitem")).toHaveCount(3);
      await expect(podium.getByRole("heading")).toHaveText(names.slice(0, 3));
      const rest = page.getByRole("list", { name: "Classifica dal quarto posto" });
      await expect(rest.getByRole("heading")).toHaveText(names.slice(3));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`rankings-dashboard-${width}.png`), fullPage: true, animations: "disabled" });
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/profile");
    await expect(page.locator(".arcade-stat").first()).toHaveCSS("animation-name", "none");
    await page.getByText("Gestione account", { exact: true }).click();
    await page.getByRole("button", { name: "Elimina account", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Questa azione non può essere annullata");
    await page.getByRole("button", { name: "Annulla", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Il mio profilo", exact: true })).toBeVisible();
  });

  test("ignores retired interface preferences and removes layout switches", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("becca-ui", "classic"));
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-ui", "arcade");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("NON È SOLO FORTUNA.");
    await expect(page.getByText(/dati demo|tavoli dimostrativi/i)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "TROVA IL TUO SOCIO.", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /interfaccia/i })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Navigazione principale" })).toHaveCount(0);
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Classifica" })).toHaveAttribute("href", "/leaderboard");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-ui", "arcade");
    await page.getByTestId("open-auth-button").click();
    await expect(page.getByTestId("auth-dialog")).toBeVisible();
    await page.getByRole("button", { name: "Chiudi", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("NON È SOLO FORTUNA.");
  });

  test("keeps rules accessible and uses system motion preferences without public effects controls", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Come si gioca", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("I segnali sono visibili a tutti");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Come si gioca", exact: true })).toBeFocused();
    await expect(page.getByRole("button", { name: "Pausa effetti", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Attiva effetti", exact: true })).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(".arcade-live-hero")).toHaveAttribute("data-motion", "off");
  });

  test("fits the real homepage and login dialog on small screens", async ({ page }) => {
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator(".club-fan svg[data-landing-card]")).toHaveCount(5);
      await expect(page.locator(".club-fan img, .club-fan image, .club-fan text")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const codeInput = await page.getByTestId("room-code-input").boundingBox();
      const codeButton = await page.getByTestId("join-by-code-button").boundingBox();
      expect(codeInput?.height).toBeGreaterThanOrEqual(44);
      expect(codeInput?.height).toBe(codeButton?.height);
      await expect(page.locator(".club-fan-card").last()).toHaveCSS("opacity", "1");
      await page.screenshot({ path: test.info().outputPath(`arcade-home-${width}.png`), fullPage: true });
      await page.getByTestId("open-auth-button").click();
      const dialog = page.getByTestId("auth-dialog");
      await expect(dialog).toBeVisible();
      const bounds = await dialog.boundingBox();
      expect(bounds?.x).toBeGreaterThanOrEqual(0);
      expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width);
      await page.getByRole("button", { name: "Chiudi", exact: true }).click();
      await page.getByTestId("room-code-input").fill("abc123");
      await expect(page.getByTestId("room-code-input")).toHaveValue("ABC123");
      await page.getByTestId("room-code-input").press("Enter");
      await expect(dialog).toBeVisible();
      await page.getByRole("button", { name: "Chiudi", exact: true }).click();
    }
  });

  test("simulates fullscreen gameplay with a larger circle and a complete four-card trick", async ({ page }) => {
    await page.goto("/preview");
    await page.getByRole("button", { name: "Tavolo demo", exact: true }).click();
    const table = page.locator(".club-match-preview .arcade-arena");
    await expect(table).toBeVisible();
    await expect(page.locator(".club-header, .club-preview-bar, .club-footer")).toHaveCount(0);
    await expect(page.getByTestId("player-hand").locator("button")).toHaveCount(10);
    await expect(page.getByRole("button", { name: "Completa la presa", exact: true })).toBeDisabled();
    await page.getByTestId("hand-card-denara-asso").click();
    await page.getByTestId("signal-button-busso").click();
    await expect(page.getByTestId("table-card-position-bottom")).toBeVisible();
    await page.getByRole("button", { name: "Completa la presa", exact: true }).click();
    await expect(page.getByTestId("game-table-center").locator(".circolo-card")).toHaveCount(4);
    await page.getByTestId("game-table-center").evaluate((element) =>
      Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
    );
    await expect(page.locator(".club-match-status")).toContainText("Presa completa: quattro carte in tavola · busso");

    for (const [width, height] of [[1280, 720], [1440, 900], [1920, 1080], [768, 1024], [390, 844], [320, 780]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.scrollTo(0, 0));
      const bounds = await table.boundingBox();
      if (!bounds) throw new Error("Demo table has no bounds");
      expect(Math.abs(bounds.width - bounds.height)).toBeLessThan(1);
      await expect(table).toHaveCSS("border-radius", "50%");
      const centerX = bounds.x + bounds.width / 2;
      const centerY = bounds.y + bounds.height / 2;
      const score = await page.getByTestId("team-points-panel").boundingBox();
      if (!score) throw new Error("Missing demo score header");
      const cardBoxes = [];
      for (const side of ["top", "left", "right", "bottom"]) {
        const seat = side === "bottom" ? page.getByTestId("player-seat-bottom") : page.getByTestId(`player-position-${side}`);
        await expect(seat).toBeVisible();
        const box = await seat.boundingBox();
        if (!box) throw new Error(`Missing ${side} demo seat`);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y + box.height).toBeLessThanOrEqual(height);
        const seatX = box.x + box.width / 2;
        const seatY = box.y + box.height / 2;
        if (side === "top") expect(box.y).toBeGreaterThan(score.y + score.height);
        if (side === "top" || side === "bottom") {
          expect(Math.abs(seatX - centerX)).toBeLessThan(1);
          expect(side === "top" ? seatY < centerY : seatY > centerY).toBe(true);
        } else {
          expect(Math.abs(seatY - centerY)).toBeLessThan(1);
          expect(side === "left" ? seatX < centerX : seatX > centerX).toBe(true);
        }
        const card = page.getByTestId(`table-card-position-${side}`).locator(".circolo-card");
        const cardBox = await card.boundingBox();
        if (!cardBox) throw new Error(`Missing ${side} demo card`);
        cardBoxes.push(cardBox);
        expect(
          box.x + box.width <= cardBox.x || box.x >= cardBox.x + cardBox.width ||
          box.y + box.height <= cardBox.y || box.y >= cardBox.y + cardBox.height,
          `${side} player overlaps their demo card at ${width}x${height}`,
        ).toBe(true);
        expect(cardBox.x).toBeGreaterThan(bounds.x);
        expect(cardBox.y).toBeGreaterThan(bounds.y);
        expect(cardBox.x + cardBox.width).toBeLessThan(bounds.x + bounds.width);
        expect(cardBox.y + cardBox.height).toBeLessThan(bounds.y + bounds.height);
      }
      for (let index = 0; index < cardBoxes.length; index++) {
        for (const other of cardBoxes.slice(index + 1)) {
          const card = cardBoxes[index];
          expect(
            card.x + card.width <= other.x || card.x >= other.x + other.width ||
            card.y + card.height <= other.y || card.y >= other.y + other.height,
            `Demo cards overlap at ${width}x${height}`,
          ).toBe(true);
        }
      }
      expect(await page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth <= innerWidth,
        vertical: document.documentElement.scrollHeight <= innerHeight,
      }))).toEqual({ horizontal: true, vertical: true });
      if (width >= 1280) expect(bounds.width).toBeGreaterThan(height * 0.55);
      await expect(page.getByTestId("player-hand").locator("img")).toHaveCount(9);
      await expect(page.locator(".club-match-preview svg[data-landing-card]")).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath(`fullscreen-demo-${width}.png`), fullPage: true });
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Ricomincia", exact: true }).click();
    await expect(page.getByTestId("player-hand").locator("button")).toHaveCount(10);
    await expect(page.getByTestId("game-table-center").locator(".circolo-card")).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByTestId("hand-card-spade-sette").click();
    await page.getByTestId("signal-button-none").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".animate-table-card-from-bottom")).toHaveCSS("animation-name", "none");
    await page.getByRole("button", { name: "Completa la presa", exact: true }).click();
    const faces = await page.getByTestId("game-table-center").locator("img").evaluateAll((images) =>
      images.map((image) => image.getAttribute("src")),
    );
    expect(new Set(faces).size).toBe(4);
    for (const face of faces) expect(face).toMatch(/\/images\/cards\/.+_spade\.png$/);
    await page.getByRole("button", { name: "Regole", exact: true }).click();
    await expect(page.getByRole("button", { name: "Chiudi le regole", exact: true })).toBeFocused();
    // Autofocus precedes Radix's modal-layer registration.
    await expect(page.getByRole("dialog")).toHaveAttribute("style", /pointer-events:\s*auto/);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Tutti i tavoli", exact: true }).click();
    await expect(page.locator(".club-header")).toBeVisible();
  });

  test("shows comic signal bubbles at all four seats without clipping or blocking play", async ({ page }) => {
    await page.goto("/preview");
    await page.getByRole("button", { name: "Tavolo demo", exact: true }).click();
    for (const [width, height] of [[1440, 900], [320, 780]]) {
      await page.setViewportSize({ width, height });
      for (const [userId, side] of [["1", "bottom"], ["2", "left"], ["3", "top"], ["4", "right"]]) {
        for (const word of ["striscio", "busso", "volo"]) {
          await page.getByRole("button", { name: "Fumetti", exact: true }).click();
          await page.getByLabel("Chi parla?").selectOption(userId);
          await page.getByRole("button", { name: word, exact: true }).click();
          await expect(page.getByRole("dialog")).toHaveCount(0);
          const bubble = page.locator(".signal-callout");
          await expect(bubble).toHaveCount(1);
          await expect(bubble).toHaveAttribute("data-position", side);
          await expect(bubble).toHaveAttribute("data-signal", word);
          await expect(bubble).toHaveCSS("pointer-events", "none");
          await bubble.evaluate((element) => Promise.all(
            element.getAnimations().filter((animation) => animation.effect?.getTiming().delay === 0).map((animation) => animation.finished),
          ));
          const box = await bubble.boundingBox();
          if (!box) throw new Error("Missing comic signal bubble");
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
          expect(box.y + box.height).toBeLessThanOrEqual(height);
          if (word === "striscio") {
            await page.screenshot({ path: test.info().outputPath(`comic-${side}-${width}.png`) });
          }
        }
      }
    }
    await expect(page.locator(".signal-callout")).toHaveCount(0, { timeout: 4000 });
    await page.getByRole("button", { name: "Pausa effetti", exact: true }).click();
    await page.getByRole("button", { name: "Fumetti", exact: true }).click();
    await page.getByRole("button", { name: "volo", exact: true }).click();
    await expect(page.locator(".signal-callout")).toBeVisible();
    await expect(page.locator(".signal-callout")).toHaveCSS("animation-name", "none");
    await page.getByRole("button", { name: "Ricomincia", exact: true }).click();
    await expect(page.locator(".signal-callout")).toHaveCount(0);
    await page.getByRole("button", { name: "Attiva effetti", exact: true }).click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByTestId("hand-card-denara-asso").click();
    await page.getByTestId("signal-button-striscio").click();
    await expect(page.locator(".signal-callout")).toHaveAttribute("data-position", "bottom");
    await expect(page.locator(".signal-callout")).toHaveCSS("animation-name", "none");
    await expect(page.getByTestId("table-card-position-bottom")).toBeVisible();
    await page.getByRole("button", { name: "Fumetti", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveAttribute("style", /pointer-events:\s*auto/);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Fumetti", exact: true })).toBeFocused();
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
