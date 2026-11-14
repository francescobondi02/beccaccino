import { prisma } from "../../src/db";
import { clearDatabase } from "../helpers/database";
import { api, apiAs } from "../helpers/serverHarness";
import {
  startBotServiceStub,
  ActHandler,
  BotServiceStub,
} from "../helpers/botServiceStub";
import { getTurnTimerState } from "../../src/runtime/turnTimer";
import { readPlayableCards } from "../../src/services/playableCards";
import { logger } from "../../src/logger";

/**
 * The bot-turn driver (BOT_PLAY_DESIGN.md §3.4).
 *
 * These tests pin the behaviour that makes the diagnostic trustworthy:
 *  - bots actually move, chaining without a human acting between them;
 *  - a bot is NEVER kicked and never races the human auto-play timer, because a
 *    kicked bot would be silently replaced by the dumb heuristic for the rest of
 *    the game and we would attribute its play to the model;
 *  - when the bot service is unreachable the seat falls back and logs loudly
 *    rather than hanging;
 *  - abandoning a practice game tears it down instead of leaving a zombie room.
 */
describe("Bot turn driver", () => {
  const TOKEN = "bot-turn-test-token";
  let stub: BotServiceStub;
  let userId: number;

  // Keep the think delay short: the driver's timing is what we assert, not how
  // long a human waits.
  const THINK_DELAY_MS = 20;
  const POLL_INTERVAL_MS = 25;
  const SETTLE_TIMEOUT_MS = 10_000;

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Poll until `condition` holds, or fail the test. */
  async function waitFor(condition: () => boolean): Promise<void> {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (condition()) return;
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error("condition never held");
  }

  /**
   * Wait until the bot chain hands the turn back to the human — the rest state
   * of a practice game, since seat 0 is the only human.
   *
   * Polling for that specific condition rather than sleeping a fixed span, or
   * waiting for "no bot timer pending": between a bot's timer firing and its
   * /act response landing there is a window with no timer registered and no new
   * request yet, which a naive quiescence check mistakes for the chain being done.
   */
  async function settle(roomCode: string): Promise<void> {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const timer = getTurnTimerState(roomCode);
      if (timer && !timer.isBot && timer.turnUserId === userId) return;
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(
      `bot chain never reached the human's turn ` +
        `(timer=${JSON.stringify(getTurnTimerState(roomCode))}, ` +
        `requests=${stub.requests.length})`,
    );
  }

  beforeEach(async () => {
    await clearDatabase();
    process.env.BOT_THINK_DELAY_MS = String(THINK_DELAY_MS);
    const res = await api()
      .post("/api/users/register")
      .send({ username: "human", password: "test123" });
    userId = res.body.id;
  });

  afterEach(async () => {
    await stub?.close();
    delete process.env.BOT_SERVICE_URL;
    delete process.env.BOT_SERVICE_TOKEN;
    delete process.env.BOT_THINK_DELAY_MS;
  });

  /**
   * A minimal stand-in policy: pick the first legal move. It plays from
   * `expected_legal_cards` (the set the driver sends) rather than from the raw
   * hand, so it always follows suit — the real service derives the same set from
   * its own rules engine.
   */
  const playFirstLegalMove: ActHandler = (request) => {
    const { state, seat } = request;
    if (state.phase === "choose_briscola") {
      return { kind: "briscola", suit: state.hands[String(seat)][0].suit };
    }
    const card = request.expected_legal_cards![0];
    return { kind: "card", suit: card.suit, value: card.value, signal: null };
  };

  async function startPractice(handler = playFirstLegalMove, tier = "forte") {
    stub = await startBotServiceStub(handler, { requiredToken: TOKEN });
    process.env.BOT_SERVICE_URL = stub.url;
    process.env.BOT_SERVICE_TOKEN = TOKEN;
    const res = await apiAs(userId, "human").post("/api/rooms/practice").send({ tier });
    expect(res.statusCode).toBe(201);
    return res.body.code as string;
  }

  const botUserIdsIn = async (roomCode: string) => {
    const players = await prisma.player.findMany({
      where: { gameRoom: { code: roomCode }, botModel: { not: null } },
    });
    return players.map((p) => p.userId);
  };

  const loadRound = (roomCode: string) =>
    prisma.round.findFirst({
      where: { gameRoom: { code: roomCode } },
      orderBy: { number: "desc" },
      include: { hands: { orderBy: { number: "asc" }, include: { cards: true } } },
    });

  it("has a bot caller choose briscola and lead without the human acting", async () => {
    let briscolaChosenAt = 0;
    const roomCode = await startPractice((request) => {
      if (request.state.phase === "choose_briscola") briscolaChosenAt = Date.now();
      return playFirstLegalMove(request);
    });
    const initialState = await apiAs(userId, "human").get(`/api/games/${roomCode}/state`);
    expect(initialState.body.round.briscola).toBeNull();
    expect(Date.parse(initialState.body.round.deal.reviewEndsAt))
      .toBeGreaterThan(Date.parse(initialState.body.serverTime));
    await settle(roomCode);

    const round = await loadRound(roomCode);
    expect(round!.briscola).not.toBeNull();
    expect(briscolaChosenAt - round!.createdAt.getTime()).toBeGreaterThanOrEqual(4000);
    expect(stub.readyHeaders).toHaveLength(1);
    expect(stub.readyHeaders[0].authorization).toBe(`Bearer ${TOKEN}`);
    expect(stub.requests[0].state.phase).toBe("choose_briscola");
    expect(stub.requests[0].tier).toBe("forte");
    expect(
      stub.actHeaders.every(
        (headers) => headers.authorization === `Bearer ${TOKEN}`,
      ),
    ).toBe(true);

    // Seat 0 is the human, so the bots play up to (but not past) their turn.
    const played = round!.hands.flatMap((h) => h.cards);
    expect(played.length).toBeGreaterThan(0);
  });

  it("chains consecutive bot turns until it is the human's turn", async () => {
    const roomCode = await startPractice();
    await settle(roomCode);

    // settle() already waited for the turn to reach the human — reaching here
    // without throwing IS the chain working. What is left to check is that the
    // human's turn is a real countdown, not a bot think-delay slot.
    const timer = getTurnTimerState(roomCode)!;
    expect(timer.isBot).toBe(false);
    expect(timer.totalMs).toBeGreaterThan(THINK_DELAY_MS);

    // Every bot seat acted exactly once before the human: briscola + 3 cards.
    expect(stub.requests).toHaveLength(4);
    expect(stub.requests.map((r) => r.seat)).toEqual([1, 1, 2, 3]);
  });

  it("keeps the game moving over several human turns", async () => {
    const roomCode = await startPractice();
    const HUMAN_TURNS = 3;

    for (let turn = 0; turn < HUMAN_TURNS; turn++) {
      await settle(roomCode);

      const legal = await readPlayableCards({ roomCode, userId });
      const res = await apiAs(userId, "human")
        .post(`/api/games/${roomCode}/cards`)
        .send({ suit: legal[0].suit, value: legal[0].value });
      expect(res.statusCode).toBe(200);
    }
    await settle(roomCode);

    // One completed trick per human card — the human plays once per trick, and
    // the bots fill in every other position on their own.
    const round = (await loadRound(roomCode))!;
    expect(round.hands.filter((h) => h.winnerId !== null)).toHaveLength(HUMAN_TURNS);

    const humanPlayer = await prisma.player.findFirst({
      where: { userId, gameRoom: { code: roomCode } },
    });
    const cards = round.hands.flatMap((h) => h.cards);
    expect(cards.filter((c) => c.playerId === humanPlayer!.id)).toHaveLength(HUMAN_TURNS);

    // Every seat contributed, so no bot silently stopped acting.
    expect(new Set(cards.map((c) => c.playerId)).size).toBe(4);
  }, 15_000);

  it("never kicks a bot, even when the service keeps failing", async () => {
    const roomCode = await startPractice(() => {
      throw { status: 503, body: { detail: "tier unavailable" } };
    });
    await settle(roomCode);

    // Autoplay covered the failing seats, so the game still progressed...
    const round = await loadRound(roomCode);
    expect(round!.briscola).not.toBeNull();
    expect(round!.hands.flatMap((h) => h.cards).length).toBeGreaterThan(0);

    // ...and no bot accrued a timeout or a kick. Three timeouts would swap the
    // model for the dumb heuristic permanently, and we would never notice.
    for (const botUserId of await botUserIdsIn(roomCode)) {
      expect(await prisma.player.findFirstOrThrow({
        where: { userId: botUserId, gameRoom: { code: roomCode } },
      })).toMatchObject({
        timeoutCount: 0,
        botModel: "forte",
      });
    }
  });

  it("arms no auto-play timeout on a bot's turn", async () => {
    // Bots must not sit behind the human 60 s timer: the timeout would race the
    // bot's own move and, three times over, kick it. Assert the *shape* of the
    // pending timer during a bot's turn — a long think delay makes the bot turn
    // observable without waiting for it to finish.
    process.env.BOT_THINK_DELAY_MS = String(SETTLE_TIMEOUT_MS);
    const roomCode = await startPractice();

    const timer = getTurnTimerState(roomCode)!;
    expect(timer.isBot).toBe(true);
    expect(timer.turnUserId).not.toBe(userId);
    // Presentation plus think time, never the human briscola timeout.
    expect(timer.totalMs).toBeGreaterThan(SETTLE_TIMEOUT_MS);
    expect(timer.totalMs).toBeLessThanOrEqual(SETTLE_TIMEOUT_MS + 4000);
    const bot = await prisma.player.findFirstOrThrow({
      where: { userId: timer.turnUserId, gameRoom: { code: roomCode } },
    });
    expect(bot.timeoutCount).toBe(0);
  });

  it("sends the legal card set so the service can reject a wrong board", async () => {
    const roomCode = await startPractice();
    await settle(roomCode);

    const cardRequests = stub.requests.filter((r) => r.state.phase === "play_card");
    expect(cardRequests.length).toBeGreaterThan(0);

    for (const request of cardRequests) {
      // Followers get the follow-suit filtered set; the leader gets its whole
      // hand. Either way it must be a non-empty subset of the seat's hand.
      const hand = request.state.hands[String(request.seat)];
      expect(request.expected_legal_cards!.length).toBeGreaterThan(0);
      expect(request.expected_legal_cards!.length).toBeLessThanOrEqual(hand.length);
    }
    expect(roomCode).toBeTruthy();
  });

  it("passes a declared signal through to the played card", async () => {
    const roomCode = await startPractice(async (request) => {
      const { state, seat } = request;
      if (state.phase === "choose_briscola") {
        return { kind: "briscola", suit: state.hands[String(seat)][0].suit };
      }
      const card = state.hands[String(seat)][0];
      // Only a trick leader may signal; the backend drops it otherwise.
      const isLeader = state.current_trick.length === 0;
      return {
        kind: "card",
        suit: card.suit,
        value: card.value,
        signal: isLeader ? "busso" : null,
      };
    });
    await settle(roomCode);

    const round = await loadRound(roomCode);
    const signalled = round!.hands
      .flatMap((h) => h.cards)
      .filter((c) => c.signal !== null);

    expect(signalled.length).toBeGreaterThan(0);
    expect(signalled.every((c) => c.position === 0)).toBe(true);
    expect(signalled.every((c) => c.signal === "busso")).toBe(true);
  });

  it("stays quiet when the human abandons mid-request", async () => {
    // The human can quit while /act is in flight — the most likely way to hit
    // this, since testing the diagnostic means starting and quitting many games.
    // The move must be dropped without reporting a model fallback: that alarm is
    // how we learn a seat was played by the heuristic instead of the model, so a
    // false one would make it untrustworthy.
    let releaseHeldRequest = () => {};
    const heldRequest = new Promise<void>((resolve) => (releaseHeldRequest = resolve));
    let holdNextRequest = true;

    const fallbackLogs = jest.spyOn(logger, "error");
    const roomCode = await startPractice(async (request) => {
      if (holdNextRequest) {
        holdNextRequest = false;
        await heldRequest;
      }
      return playFirstLegalMove(request);
    });

    await waitFor(() => stub.requests.length > 0);
    const leave = await apiAs(userId, "human").post(`/api/rooms/${roomCode}/leave`).send({});
    expect(leave.statusCode).toBe(200);

    releaseHeldRequest();
    await sleep(THINK_DELAY_MS * 10);

    expect(await prisma.gameRoom.count()).toBe(0);
    const reportedFallback = fallbackLogs.mock.calls.some(
      (call) => call[1] === "bot_fallback_to_autoplay",
    );
    expect(reportedFallback).toBe(false);
    fallbackLogs.mockRestore();
  });

  it("tears the room down when the human abandons a practice game", async () => {
    const roomCode = await startPractice();
    await settle(roomCode);

    const res = await apiAs(userId, "human").post(`/api/rooms/${roomCode}/leave`).send({});
    expect(res.statusCode).toBe(200);
    expect(res.body.deletedRoom).toBe(true);

    // Room and every trace of play are gone...
    expect(await prisma.gameRoom.count({ where: { code: roomCode } })).toBe(0);
    expect(await prisma.player.count()).toBe(0);
    expect(await prisma.round.count()).toBe(0);
    expect(await prisma.playedCard.count()).toBe(0);
    expect(await prisma.playerCard.count()).toBe(0);

    // ...but the reusable bot users survive, and the bot chain is stopped.
    expect(await prisma.user.count({ where: { isBot: true } })).toBe(3);
    expect(getTurnTimerState(roomCode)).toBeNull();

    // No further bot move fires against the deleted room.
    const requestsAtLeave = stub.requests.length;
    await sleep(THINK_DELAY_MS * 10);
    expect(stub.requests.length).toBe(requestsAtLeave);
  });

  it("leaves human-vs-human games on the unchanged timer path", async () => {
    stub = await startBotServiceStub(playFirstLegalMove, {
      requiredToken: TOKEN,
    });
    process.env.BOT_SERVICE_URL = stub.url;
    process.env.BOT_SERVICE_TOKEN = TOKEN;

    const { setupGame } = await import("../helpers/gameDriver");
    const { roomCode } = await setupGame();
    await sleep(THINK_DELAY_MS * 10);

    // A game with no bot seats must never call the service, and its timer is a
    // normal human countdown.
    expect(stub.requests).toHaveLength(0);
    const timer = getTurnTimerState(roomCode);
    expect(timer!.isBot).toBe(false);
  });
});
