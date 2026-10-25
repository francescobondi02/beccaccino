import { test, expect, type WebSocketRoute } from "@playwright/test";
import type { GameStateResponse, PlayedCardData } from "../src/game/model";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`live cards travel and collect at every winning seat (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: reducedMotion === "reduce" ? 390 : 1440, height: 900 });
    const names = ["Giulia", "Luca", "Marta", "Diego"];
    const state: GameStateResponse = {
      status: "playing", pausedAt: null,
      round: { id: 30, number: 1, briscola: "spade" },
      callerUserId: 1, currentTurnUserId: 1, currentHandNumber: 1,
      myCards: [{ id: 40, suit: "spade", value: "quattro", playerId: 10, roundId: 30, inHand: true }],
      playedCards: [{ playerId: 11, userId: 2, suit: "coppe", value: "asso", position: 0 }],
      lastHandCards: [], turnTimer: null, finishedGame: null,
      totalPoints: { team0Points: 0, team1Points: 0, team0Figures: 0, team1Figures: 0 },
      isPractice: false, allHands: null,
    };
    await page.route("**/users/me", (route) => route.fulfill({ json: { id: 1, username: names[0] } }));
    await page.route("**/rooms/ROOM", (route) => route.fulfill({ json: {
      id: 20, code: "ROOM", started: true, finished: false,
      players: names.map((username, seat) => ({
        id: 10 + seat, userId: seat + 1, username, seat, team: seat % 2, isReady: true,
      })),
    } }));
    let readyAt = 0;
    await page.route("**/games/ROOM/state", (route) => {
      if (state.round.deal) state.round.deal.remainingMs = Math.max(0, readyAt - Date.now());
      return route.fulfill({ json: state });
    });
    await page.route("**/games/playable-cards/ROOM", (route) =>
      route.fulfill({ json: { playableCards: state.myCards } }));
    let posts = 0;
    await page.route("**/games/play-card", (route) => {
      posts += 1;
      return route.fulfill({ json: { success: true } });
    });
    let socket: WebSocketRoute | undefined;
    await page.routeWebSocket(/\/socket\.io\//, (wire) => {
      socket = wire;
      wire.onMessage((message) => {
        if (message === "40") wire.send('40{"sid":"motion"}');
        const ack = String(message).match(/^42(\d+)\["join_room"/);
        if (ack) wire.send(`43${ack[1]}[{"ok":true}]`);
      });
      wire.send('0{"sid":"motion","upgrades":[],"pingInterval":25000,"pingTimeout":20000}');
    });
    const emit = (event: string, payload: unknown) => {
      if (!socket) throw new Error("Test socket is not connected");
      socket.send(`42${JSON.stringify([event, payload])}`);
    };
    await page.goto("/game/ROOM");
    await expect(page.getByTestId("game-layout")).toBeVisible();
    await expect(page.locator("[data-card-user-id]")).toHaveCount(1);
    expect(await page.locator("[data-card-user-id] > div").evaluateAll((elements) =>
      elements.flatMap((element) => element.getAnimations()).length)).toBe(0);
    state.playedCards = [];
    await page.reload();
    await expect(page.getByTestId("game-layout")).toBeVisible();
    await expect.poll(() => Boolean(socket)).toBe(true);
    await expect(page.getByRole("button", { name: "Pausa effetti", exact: true })).toHaveCount(0);

    for (let winner = 1; winner <= 4; winner += 1) {
      await page.emulateMedia({ reducedMotion });
      await page.evaluate(() => new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const handNumber = winner >= 3 ? 10 : winner;
      const cards: PlayedCardData[] = names.map((_, position) => ({
        playerId: 10 + position, userId: position + 1, position, handNumber,
        suit: position + 1 === winner ? "spade" : "coppe",
        value: position + 1 === winner ? "quattro" : ["tre", "due", "asso", "re"][position],
      }));
      if (winner === 1) {
        await page.getByTestId("hand-card-spade-quattro").click();
        await page.getByRole("button", { name: "Niente", exact: true }).click();
        await expect.poll(() => posts).toBe(1);
        await expect(page.locator("[data-card-user-id]")).toHaveCount(0);
        state.myCards = [];
      }
      for (const card of cards) {
        if (card.userId === 1) state.myCards = state.myCards.filter((held) =>
          held.suit !== card.suit || held.value !== card.value);
        state.playedCards = cards.slice(0, card.position + 1);
        emit("card_played", card);
        await expect(page.locator("[data-card-user-id]")).toHaveCount(card.position + 1);
        if (card.position === 0) {
          const entries = await page.locator("[data-card-user-id] > div").evaluateAll((elements) =>
            elements.flatMap((element) => element.getAnimations())
              .filter((animation) => animation.effect?.getTiming().duration === 420).length);
          expect(entries).toBe(reducedMotion === "reduce" ? 0 : 1);
        }
      }
      state.playedCards = [];
      state.currentHandNumber = handNumber + 1;
      if (winner === 3) {
        readyAt = Date.now() + 8000;
        state.status = "choosing_briscola";
        state.round = { id: 31, number: 2, briscola: null,
          deal: { remainingMs: 8000, animationMs: 2400, reviewMs: 1600 } };
        state.roundSummary = {
          roundNumber: 1, team0Points: 6, team1Points: 5, winnerTeam: 0,
        };
        state.myCards = ["asso", "due", "tre", "quattro", "cinque", "sei", "sette", "fante", "cavallo", "re"]
          .map((value, index) => ({ id: 50 + index, suit: "coppe", value, playerId: 10, roundId: 31, inHand: true }));
        emit("new_round_started", { roundId: 31, roundNumber: 2, callerUserId: 1 });
      } else if (winner === 4) {
        state.status = "finished";
        state.finishedGame = {
          winnerTeam: 1, totalRounds: 1, finalScores: { team0: 4, team1: 7 },
          roundsWon: { team0: 0, team1: 1 },
        };
        emit("game_finished", state.finishedGame);
      } else {
        emit("turn_timer_started", { turnUserId: winner, totalMs: 60000, phase: "play_card" });
      }
      await expect(page.getByText(`Presa a ${names[winner - 1]}`, { exact: true })).toBeVisible();
      await expect(page.locator('[data-winning-card="true"]')).toHaveAttribute("data-card-user-id", String(winner));
      const flights = await page.locator("[data-card-user-id]").evaluateAll((slots) =>
        slots.flatMap((slot) => slot.firstElementChild!.getAnimations()
          .filter((animation) => animation.effect?.getTiming().fill === "forwards")
          .map((animation) => ({
            duration: animation.effect!.getTiming().duration,
            delay: animation.effect!.getTiming().delay,
          }))));
      expect(flights).toHaveLength(reducedMotion === "reduce" ? 0 : 4);
      if (reducedMotion !== "reduce") {
        expect(flights[0].duration).toBe(winner >= 3 ? 350 : 650);
        expect(flights[0].delay).toBe(winner >= 3 ? 500 : 1800);
        if (winner === 2) {
          await page.emulateMedia({ reducedMotion: "reduce" });
          await expect.poll(() => page.locator("[data-card-user-id] > div").evaluateAll((elements) =>
            elements.flatMap((element) => element.getAnimations()).length)).toBe(0);
        } else {
          const distances = await page.locator("[data-card-user-id] > div").evaluateAll(async (elements, winnerId) => {
            const animations = elements.flatMap((element) => element.getAnimations())
              .filter((animation) => animation.effect?.getTiming().fill === "forwards");
            await Promise.all(animations.map((animation) => animation.finished));
            const seat = document.querySelector(`[data-player-user-id="${winnerId}"]`)!.getBoundingClientRect();
            return elements.map((element) => {
              const card = element.getBoundingClientRect();
              return Math.hypot(card.x + card.width / 2 - seat.x - seat.width / 2,
                card.y + card.height / 2 - seat.y - seat.height / 2);
            });
          }, winner);
          distances.forEach((distance) => expect(distance).toBeLessThan(2));
        }
      }
      await expect(page.locator("[data-card-user-id]")).toHaveCount(0);
      if (winner === 3) {
        const recap = page.getByRole("dialog", { name: "Smazzata 1 conclusa" });
        await expect(recap).toBeVisible();
        await expect(page.getByTestId("card-deal")).toHaveCount(0);
        await expect(recap).toBeHidden();
        await expect(page.getByTestId("card-deal")).toBeAttached();
        await expect(page.getByRole("dialog", { name: "Scegli la briscola" })).toBeVisible();
        state.status = "playing";
        state.round.briscola = "spade";
        state.round.deal = null;
        state.roundSummary = null;
        emit("briscola_chosen", { briscola: "spade" });
        await expect(page.getByRole("dialog")).toHaveCount(0);
      }
    }
    await expect(page.getByTestId("game-result-page")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("game-result-page")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
