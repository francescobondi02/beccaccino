import { test, expect, type WebSocketRoute } from "@playwright/test";
import type { GameStateResponse, PlayedCardData } from "../src/game/model";

test.describe("Responsive table", () => {
  test.use({ screen: { width: 390, height: 844 } });
  test("keeps central messages, seats, cards and controls separate on every screen size", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const players = ["Giulia", "Luca", "Marta", "Diego"].map((username, seat) => ({
      id: 10 + seat, userId: seat + 1, username, seat, team: seat % 2, isReady: true,
      botModel: seat === 1 || seat === 2 ? "forte" : null,
    }));
    const state: GameStateResponse = {
      status: "playing", pausedAt: null,
      round: { id: 30, number: 1, briscola: "spade" },
      callerUserId: 3, currentTurnUserId: 1, currentHandNumber: 1,
      myCards: ["asso", "due", "tre", "quattro", "cinque", "sei", "sette", "fante", "cavallo", "re"]
        .map((value, index) => ({ id: 40 + index, suit: "denara", value, playerId: 10, roundId: 30, inHand: true })),
      playedCards: [
        { playerId: 12, userId: 3, suit: "coppe", value: "cavallo", position: 0, signal: "busso" },
        { playerId: 11, userId: 2, suit: "coppe", value: "tre", position: 1 },
        { playerId: 13, userId: 4, suit: "spade", value: "due", position: 2 },
      ],
      lastHandCards: [], finishedGame: null, isPractice: false, allHands: null,
      totalPoints: { team0Points: 0, team1Points: 0, team0Figures: 0, team1Figures: 0 },
      turnTimer: { turnUserId: 1, remainingMs: 45000, totalMs: 60000, phase: "play_card" },
      playerControls: players.map(({ userId, botModel }) => ({ userId, botModel, abandonedAt: null })),
    };
    await page.route("**/users/me", (route) => route.fulfill({ json: { id: 1, username: players[0].username } }));
    await page.route("**/rooms/ROOM", (route) => route.fulfill({ json: {
      id: 20, code: "ROOM", started: true, finished: false, isPractice: state.isPractice, players,
    } }));
    let holdSnapshot = false;
    let pendingSnapshots = 0;
    await page.route("**/games/ROOM/state", (route) => {
      if (!holdSnapshot) return route.fulfill({ json: state });
      pendingSnapshots += 1;
    });
    await page.route("**/games/playable-cards/ROOM", (route) => route.fulfill({ json: { playableCards: [] } }));
    let socket: WebSocketRoute | undefined;
    await page.routeWebSocket(/\/socket\.io\//, (wire) => {
      socket = wire;
      wire.send('0{"sid":"layout","upgrades":[],"pingInterval":25000,"pingTimeout":20000}');
      wire.onMessage((message) => {
        if (message === "40") wire.send('40{"sid":"layout"}');
        const ack = String(message).match(/^42(\d+)\["join_room"/);
        if (ack) wire.send(`43${ack[1]}[{"ok":true}]`);
      });
    });
    for (const [width, height, mode] of [
      [1280, 900, "multiplayer"], [1280, 720, "multiplayer"], [820, 1180, "multiplayer"],
      [761, 900, "multiplayer"], [760, 900, "multiplayer"],
      [390, 844, "multiplayer"], [320, 700, "multiplayer"], [320, 700, "afk"], [320, 700, "practice"],
      [844, 390, "multiplayer"], [640, 360, "multiplayer"], [568, 320, "multiplayer"],
      [640, 360, "afk"], [568, 360, "practice"],
    ] as const) {
      holdSnapshot = false;
      state.isPractice = mode === "practice";
      state.round.briscola = height <= 540 ? "bastoni" : "spade";
      state.totalPoints.team0Points = height <= 540 ? 40 : 0;
      state.totalPoints.team1Points = height <= 540 ? 38 : 0;
      state.playerControls = players.map(({ userId, botModel }) => ({
        userId, botModel: userId === 1 && mode === "afk" ? "forte" : botModel, abandonedAt: null,
      }));
      await page.setViewportSize({ width, height });
      await page.goto("/game/ROOM");
      await expect(page.locator("[data-card-user-id]")).toHaveCount(3);
      await expect(page.getByTestId("table-status")).toContainText("Marta dichiara busso");
      pendingSnapshots = 0;
      holdSnapshot = true;
      const collisions = () => page.evaluate(() => {
        const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        const arena = rect(".arcade-arena");
        const status = rect('[data-testid="table-status"]');
        const hand = rect('[data-testid="player-hand"]');
        const controls = rect(".arcade-game-tools");
        const notice = rect(".arcade-table-notice");
        const score = rect(".arcade-score-panel");
        const seats = [...document.querySelectorAll("[data-player-user-id]")].map((seat) => seat.getBoundingClientRect());
        const cards = [...document.querySelectorAll("[data-card-user-id]")].map((card) => card.getBoundingClientRect());
        const topCard = rect('[data-testid="table-card-position-top"]');
        const bottomCard = document.querySelector('[data-testid="table-card-position-bottom"]')?.getBoundingClientRect();
        const sideCards = ["left", "right"].map((position) => rect(`[data-testid="table-card-position-${position}"]`));
        const desktop = matchMedia("(min-width: 761px) and (min-height: 541px)").matches;
        const bubbles = [...document.querySelectorAll(".signal-callout")]
          .filter((bubble) => getComputedStyle(bubble).display !== "none")
          .map((bubble) => bubble.getBoundingClientRect());
        const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        return [
          ...sideCards.map((card, index) => desktop
            ? (card.top < topCard.bottom || (bottomCard && card.bottom > bottomCard.top)) && `side card ${index} outside middle row`
            : card.top < status.bottom && `side card ${index} above compact row`),
          ...cards.flatMap((card, index) => [
            seats.some((seat) => overlaps(card, seat)) && `card ${index} / seat`,
            overlaps(card, status) && `card ${index} / status`,
            overlaps(card, notice) && `card ${index} / notice`,
            bubbles.some((bubble) => overlaps(card, bubble)) && `card ${index} / signal bubble`,
            card.top < arena.top || card.bottom > arena.bottom ? `card ${index} outside table` : false,
            cards.some((other) => other !== card && overlaps(card, other)) && `card ${index} / card`,
          ]),
          seats.some((seat) => overlaps(status, seat)) && "status / seat",
          seats.some((seat) => overlaps(notice, seat)) && "notice / seat",
          seats.some((seat, index) => seats.some((other, otherIndex) => index !== otherIndex && overlaps(seat, other))) && "seat / seat",
          overlaps(notice, score) && "notice / score",
          status.top < arena.top || status.bottom > arena.bottom ? "status outside table" : false,
          overlaps(hand, controls) && "hand / controls",
          seats.some((seat) => overlaps(seat, controls)) && "seat / controls",
          innerHeight <= 540 && hand.bottom > innerHeight && "hand outside viewport",
          document.documentElement.scrollWidth > innerWidth && "horizontal overflow",
        ].filter(Boolean);
      });
      expect(await collisions(), `During play: ${mode} ${width}x${height}`).toEqual([]);
      if (!socket) throw new Error("Test socket is not connected");
      socket.send(`42${JSON.stringify(["card_played", {
        playerId: 10, userId: 1, suit: "coppe", value: "asso", position: 3, handNumber: 1,
      }])}`);
      await expect(page.locator("[data-card-user-id]")).toHaveCount(4);
      expect(await collisions(), `Completed trick: ${mode} ${width}x${height}`).toEqual([]);
      const occupiedLayout = {
        arena: await page.locator(".arcade-arena").boundingBox(),
        hand: await page.getByTestId("player-hand").boundingBox(),
      };
      if (height <= 540 || width >= 760) {
        await page.screenshot({ path: test.info().outputPath(`${mode}-${width}x${height}.png`) });
      }
      await expect(page.locator("[data-card-user-id]")).toHaveCount(0);
      if (width > 760 && height > 540) {
        expect(await page.locator(".arcade-arena").boundingBox(), `Table shifted after collection at ${width}x${height}`).toEqual(occupiedLayout.arena);
        expect(await page.getByTestId("player-hand").boundingBox(), `Hand shifted after collection at ${width}x${height}`).toEqual(occupiedLayout.hand);
      }
      expect(pendingSnapshots).toBeGreaterThan(0);
      if (height <= 540) {
        const cards = state.myCards;
        state.myCards = [];
        holdSnapshot = false;
        await page.reload();
        await expect(page.getByTestId("player-hand").getByRole("button")).toHaveCount(0);
        expect(await page.locator(".arcade-arena").boundingBox(), `Table shifted with an empty hand at ${width}x${height}`).toEqual(occupiedLayout.arena);
        const emptyHand = await page.getByTestId("player-hand").boundingBox();
        expect(emptyHand?.y).toEqual(occupiedLayout.hand?.y);
        expect(emptyHand?.height).toEqual(occupiedLayout.hand?.height);
        state.myCards = cards;
      }
    }
  });
});

for (const [view, reducedMotion, width, height] of [
  ["desktop", "no-preference", 1440, 900],
  ["portrait", "reduce", 390, 900],
  ["landscape", "no-preference", 844, 390],
] as const) {
  test(`live cards travel and collect at every winning seat (${view}, ${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width, height });
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
    if (view === "portrait") await page.getByRole("button", { name: "Continua in verticale", exact: true }).click();
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
