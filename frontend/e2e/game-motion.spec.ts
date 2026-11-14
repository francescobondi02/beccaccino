import { test, expect, type WebSocketRoute } from "@playwright/test";
import type { GameState, PlayedCard } from "../../backend/src/contract/game";
import { cardsOf, gameState, iso, withCurrentServerTime, score, tablePlayers } from "./helpers/gameState";

test.describe("Responsive table", () => {
  test("keeps central messages, seats, cards and controls separate on every screen size", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const players = tablePlayers().map((player) => ({
      ...player, botModel: player.seat === 1 || player.seat === 2 ? "forte" as const : null,
    }));
    const trick: PlayedCard[] = [
      { userId: 3, suit: "coppe", value: "cavallo", signal: "busso" },
      { userId: 2, suit: "coppe", value: "tre", signal: null },
      { userId: 4, suit: "spade", value: "due", signal: null },
    ];
    const state = gameState({
      round: { number: 1, callerUserId: 3, briscola: "spade", cricca: false, deal: null },
      trick: { number: 1, cards: trick },
      myHand: cardsOf("denara", ["asso", "due", "tre", "quattro", "cinque", "sei", "sette", "fante", "cavallo", "re"]),
    });
    await page.route("**/users/me", (route) => route.fulfill({ json: { id: 1, username: players[0].username } }));
    await page.route("**/games/ROOM/state", (route) => route.fulfill({ json: withCurrentServerTime(state) }));
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
      [1280, 900, "multiplayer"], [1280, 720, "multiplayer"],
      [1024, 600, "practice"], [1024, 600, "afk"],
    ] as const) {
      state.isPractice = mode === "practice";
      state.players = players.map((player) => ({
        ...player, botModel: player.userId === 1 && mode === "afk" ? "forte" : player.botModel,
      }));
      state.turn = { userId: 1, phase: "play_card", startedAt: iso(Date.now()), deadline: iso(Date.now() + 45_000) };
      await page.setViewportSize({ width, height });
      await page.goto("/game/ROOM");
      await expect(page.locator("[data-card-user-id]")).toHaveCount(3);
      await expect(page.getByTestId("table-status")).toContainText("Marta dichiara busso");
      const collisions = () => page.evaluate(() => {
        const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        const arena = rect(".arcade-arena");
        const status = rect('[data-testid="table-status"]');
        const hand = rect('[data-testid="player-hand"]');
        const controls = rect(".arcade-game-tools");
        const notice = rect(".arcade-table-notice");
        const score = rect(".arcade-score-panel");
        const briscola = rect('[data-testid="briscola-panel"]');
        const seats = [...document.querySelectorAll("[data-player-user-id]")].map((seat) => seat.getBoundingClientRect());
        const cards = [...document.querySelectorAll("[data-card-user-id]")].map((card) => card.getBoundingClientRect());
        const topCard = rect('[data-testid="table-card-position-top"]');
        const bottomCard = document.querySelector('[data-testid="table-card-position-bottom"]')?.getBoundingClientRect();
        const sideCards = ["left", "right"].map((position) => rect(`[data-testid="table-card-position-${position}"]`));
        const bubbles = [...document.querySelectorAll(".signal-callout")]
          .filter((bubble) => getComputedStyle(bubble).display !== "none")
          .map((bubble) => bubble.getBoundingClientRect());
        const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        return [
          ...sideCards.map((card, index) =>
            (card.top < topCard.bottom || (bottomCard && card.bottom > bottomCard.top)) && `side card ${index} outside middle row`),
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
          overlaps(notice, briscola) && "notice / briscola",
          (briscola.width === 0 || briscola.bottom > innerHeight) && "briscola hidden",
          status.top < arena.top || status.bottom > arena.bottom ? "status outside table" : false,
          overlaps(hand, controls) && "hand / controls",
          seats.some((seat) => overlaps(seat, controls)) && "seat / controls",
          document.documentElement.scrollWidth > innerWidth && "horizontal overflow",
        ].filter(Boolean);
      });
      expect(await collisions(), `During play: ${mode} ${width}x${height}`).toEqual([]);
      if (!socket) throw new Error("Test socket is not connected");
      const card = { suit: "coppe", value: "asso" } as const;
      socket.send(`42${JSON.stringify(["game_state", withCurrentServerTime({
        ...state, version: 2, myHand: state.myHand.slice(1), trick: { number: 2, cards: [] },
        lastTrick: {
          roundNumber: 1, trickNumber: 1, winnerUserId: 4,
          cards: [...trick, { ...card, userId: 1, signal: null }], onTableUntil: iso(Date.now() + 3000),
        },
        turn: { userId: 4, phase: "play_card", startedAt: iso(Date.now()), deadline: null },
        lastAction: { kind: "card_played", userId: 1, card, signal: null, source: "human", takeover: false },
      })])}`);
      await expect(page.locator("[data-card-user-id]")).toHaveCount(4);
      expect(await collisions(), `Completed trick: ${mode} ${width}x${height}`).toEqual([]);
      const occupiedLayout = {
        arena: await page.locator(".arcade-arena").boundingBox(),
        hand: await page.getByTestId("player-hand").boundingBox(),
      };
      await page.screenshot({ path: test.info().outputPath(`${mode}-${width}x${height}.png`) });
      await expect(page.locator("[data-card-user-id]")).toHaveCount(0);
      expect(await page.locator(".arcade-arena").boundingBox(), `Table shifted after collection at ${width}x${height}`).toEqual(occupiedLayout.arena);
      expect(await page.getByTestId("player-hand").boundingBox(), `Hand shifted after collection at ${width}x${height}`).toEqual(occupiedLayout.hand);
    }
  });
});

for (const [view, reducedMotion, width, height] of [
  ["desktop", "no-preference", 1440, 900],
  ["laptop", "reduce", 1280, 720],
] as const) {
  test(`live cards travel and collect at every winning seat (${view}, ${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width, height });
    const names = ["Giulia", "Luca", "Marta", "Diego"];
    const myCard = cardsOf("spade", ["quattro"]);
    let state = gameState({
      isPractice: false, players: tablePlayers(names),
      trick: { number: 1, cards: [{ userId: 2, suit: "coppe", value: "asso", signal: null }] },
      myHand: myCard, playableCards: myCard,
      turn: { userId: 1, phase: "play_card", startedAt: iso(Date.now()), deadline: null },
    });
    // The next state after cards[position] is played; the trick's last card also applies `after`.
    const play = (cards: PlayedCard[], position: number, handNumber: number, after: Partial<GameState> = {}) => {
      const { userId, suit, value, signal } = cards[position];
      state = {
        ...state, version: state.version + 1,
        myHand: state.myHand.filter((held) => held.suit !== suit || held.value !== value), playableCards: [],
        trick: { number: handNumber, cards: cards.slice(0, position + 1) },
        turn: { userId: cards[position + 1]?.userId ?? userId, phase: "play_card", startedAt: iso(Date.now()), deadline: null },
        lastAction: { kind: "card_played", userId, card: { suit, value }, signal, source: "human", takeover: false },
        ...after,
      };
      return withCurrentServerTime(state);
    };
    await page.route("**/users/me", (route) => route.fulfill({ json: { id: 1, username: names[0] } }));
    await page.route("**/games/ROOM/state", (route) => route.fulfill({ json: withCurrentServerTime(state) }));
    let posts = 0;
    let postResponse: GameState | undefined;
    await page.route("**/games/ROOM/cards", (route) => {
      posts += 1;
      return route.fulfill({ json: postResponse });
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
    state.trick = { number: 1, cards: [] };
    await page.reload();
    await expect(page.getByTestId("game-layout")).toBeVisible();
    await expect.poll(() => Boolean(socket)).toBe(true);
    await expect(page.getByRole("button", { name: "Pausa effetti", exact: true })).toHaveCount(0);

    for (let winner = 1; winner <= 4; winner += 1) {
      await page.emulateMedia({ reducedMotion });
      await page.evaluate(() => new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const handNumber = winner >= 3 ? 10 : winner;
      const cards: PlayedCard[] = names.map((_, position) => ({
        userId: position + 1, signal: null,
        suit: position + 1 === winner ? "spade" : "coppe",
        value: position + 1 === winner ? "quattro" : (["tre", "due", "asso", "re"] as const)[position],
      }));
      // Built when the fourth card lands, so display times start then.
      const trickEnd = (): Partial<GameState> => {
        const lastTrick = {
          roundNumber: state.round.number, trickNumber: handNumber, winnerUserId: winner, cards,
          onTableUntil: iso(Date.now() + 3000),
        };
        if (winner === 3) {
          const readyAt = Date.now() + 8000;
          return {
            lastTrick, status: "choosing_briscola", trick: null,
            round: {
              number: 2, callerUserId: 1, briscola: null, cricca: false,
              deal: { animationEndsAt: iso(readyAt - 1600), reviewEndsAt: iso(readyAt) },
            },
            roundSummary: { roundNumber: 1, score: score(6, 5), winnerTeam: 0, visibleUntil: iso(readyAt - 4000) },
            myHand: cardsOf("coppe", ["asso", "due", "tre", "quattro", "cinque", "sei", "sette", "fante", "cavallo", "re"]),
            turn: { userId: 1, phase: "choose_briscola", startedAt: iso(readyAt), deadline: null },
          };
        }
        if (winner === 4) {
          return {
            lastTrick, status: "finished", trick: null, turn: null,
            result: {
              winnerTeam: 1, totalRounds: 1, finalScores: { team0: 4, team1: 7 }, roundsWon: { team0: 0, team1: 1 },
              statistics: { players: [], rounds: [{ number: 1, winnerTeam: 1, score: score(4, 7) }] },
            },
          };
        }
        return {
          lastTrick, trick: { number: handNumber + 1, cards: [] },
          turn: { userId: winner, phase: "play_card", startedAt: iso(Date.now()), deadline: null },
        };
      };
      for (let position = 0; position < cards.length; position += 1) {
        const next = play(cards, position, handNumber, position === 3 ? trickEnd() : {});
        if (winner === 1 && position === 0) {
          postResponse = next;
          await page.getByTestId("hand-card-spade-quattro").click();
          await page.getByRole("button", { name: "Niente", exact: true }).click();
          await expect.poll(() => posts).toBe(1);
        } else {
          emit("game_state", next);
        }
        await expect(page.locator("[data-card-user-id]")).toHaveCount(position + 1);
        if (position === 0) {
          const entries = await page.locator("[data-card-user-id] > div").evaluateAll((elements) =>
            elements.flatMap((element) => element.getAnimations())
              .filter((animation) => animation.effect?.getTiming().duration === 420).length);
          expect(entries).toBe(reducedMotion === "reduce" ? 0 : 1);
        }
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
        state = {
          ...state, version: state.version + 1, status: "playing",
          round: { ...state.round, briscola: "spade", deal: null }, roundSummary: null,
          trick: { number: 1, cards: [] },
          turn: { userId: 1, phase: "play_card", startedAt: iso(Date.now()), deadline: null },
          lastAction: { kind: "briscola_chosen", userId: 1, suit: "spade", source: "human", takeover: false },
        };
        emit("game_state", withCurrentServerTime(state));
        await expect(page.getByRole("dialog")).toHaveCount(0);
      }
    }
    await expect(page.getByTestId("game-result-page")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("game-result-page")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
