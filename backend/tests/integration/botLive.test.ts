import { prisma } from "../../src/db";
import { clearDatabase } from "../helpers/database";
import { api, apiAs } from "../helpers/serverHarness";
import { getTurnTimerState } from "../../src/runtime/turnTimer";
import { readPlayableCards } from "../../src/services/playableCards";
import { ensureBotServiceReady } from "../../src/services/botClient";
import { isBotTier } from "../../src/services/botUsers";
import { logger } from "../../src/logger";

/**
 * End-to-end against the REAL Python bot service — the only test that proves the
 * trained model, not a stub, can play a game through this backend.
 *
 * Explicitly enabled only when the Python service is part of the test run:
 *
 *     cd ai && BOT_SERVICE_TOKEN=local-secret \
 *       uvicorn serving.app:app --port 8011
 *     cd backend && RUN_LIVE_BOT_TESTS=true \
 *       BOT_SERVICE_URL=http://localhost:8011 \
 *       BOT_SERVICE_TOKEN=local-secret npm run test:integration
 *
 * What it can prove is narrow but exactly what the diagnostic needs: the model
 * accepts our serialized board (no 409/422 legality disagreement), returns legal
 * moves for every seat, and drives a full round to a score. Whether it plays
 * *well* is a judgement for a human watching, not an assertion.
 */
const LIVE_SERVICE_URL = process.env.BOT_SERVICE_URL;
const describeLive =
  process.env.RUN_LIVE_BOT_TESTS === "true" ? describe : describe.skip;

describeLive("Live bot service (real model)", () => {
  const TIER = process.env.BOT_LIVE_TIER ?? "forte";
  const TRICKS_PER_ROUND = 10;
  const SETTLE_TIMEOUT_MS = 30_000;
  const POLL_INTERVAL_MS = 50;

  let userId: number;
  let loggedErrors: jest.SpyInstance;

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Real inference plus a full round of HTTP; the default 5 s is not enough.
  jest.setTimeout(120_000);

  beforeAll(async () => {
    if (!LIVE_SERVICE_URL) {
      throw new Error("BOT_SERVICE_URL is required for live bot tests");
    }
    if (!isBotTier(TIER)) {
      throw new Error(`BOT_LIVE_TIER is invalid: ${TIER}`);
    }
    await ensureBotServiceReady(TIER);
    process.env.BOT_THINK_DELAY_MS = "0";
  });

  beforeEach(async () => {
    loggedErrors = jest.spyOn(logger, "error");
    await clearDatabase();
    const res = await api()
      .post("/api/users/register")
      .send({ username: "human", password: "test123" });
    userId = res.body.id;
  });

  afterEach(() => {
    const fallbacks = loggedErrors.mock.calls.filter(
      ([, message]) => message === "bot_fallback_to_autoplay",
    );
    loggedErrors.mockRestore();
    expect(fallbacks).toHaveLength(0);
  });

  /** Wait for the turn to come back to the human. */
  async function waitForHumanTurn(roomCode: string): Promise<void> {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const timer = getTurnTimerState(roomCode);
      if (timer && !timer.isBot && timer.turnUserId === userId) {
        if (timer.phase !== "choose_briscola") return;
        const response = await apiAs(userId, "human")
          .post(`/api/games/${roomCode}/briscola`)
          .send({ suit: "denara" });
        expect(response.statusCode).toBe(200);
      }

      const room = await prisma.gameRoom.findUnique({ where: { code: roomCode } });
      if (room?.finished) return;
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error("bots never handed the turn back");
  }

  it("plays a full round against the trained model", async () => {
    const created = await apiAs(userId, "human")
      .post("/api/rooms/practice")
      .send({ tier: TIER });
    expect(created.statusCode).toBe(201);
    const roomCode = created.body.code;

    // Play the human's card in each trick; the bots fill every other seat.
    for (let trick = 0; trick < TRICKS_PER_ROUND; trick++) {
      await waitForHumanTurn(roomCode);

      const legal = await readPlayableCards({ roomCode, userId });
      if (legal.length === 0) break;

      const res = await apiAs(userId, "human")
        .post(`/api/games/${roomCode}/cards`)
        .send({ suit: legal[0].suit, value: legal[0].value });
      expect(res.statusCode).toBe(200);
    }
    await sleep(2_000);

    const round = await prisma.round.findFirst({
      where: { gameRoom: { code: roomCode }, number: 1 },
      include: { hands: { include: { cards: true } } },
    });

    // The round completed: briscola chosen by a bot caller, all 40 cards played.
    expect(round!.briscola).not.toBeNull();
    expect(round!.hands).toHaveLength(TRICKS_PER_ROUND);
    expect(round!.hands.flatMap((h) => h.cards)).toHaveLength(40);
    expect(round!.hands.every((h) => h.winnerId !== null)).toBe(true);

    // And it scored: 35 raw points per round (32 card points + 3 last-trick).
    const raw = (points: number, figures: number) => points * 3 + figures;
    expect(
      raw(round!.team0Points, round!.team0Figures) +
        raw(round!.team1Points, round!.team1Figures),
    ).toBe(35);
  });

  it("declares signals as the trick leader", async () => {
    // The whole reason for this feature: check the model uses busso/striscio/volo.
    // Not asserting they are *honest* — that needs a human looking at the hands —
    // only that the signal path works end to end with the real policy.
    const created = await apiAs(userId, "human")
      .post("/api/rooms/practice")
      .send({ tier: TIER });
    const roomCode = created.body.code;

    for (let trick = 0; trick < TRICKS_PER_ROUND; trick++) {
      await waitForHumanTurn(roomCode);
      const legal = await readPlayableCards({ roomCode, userId });
      if (legal.length === 0) break;
      await apiAs(userId, "human")
        .post(`/api/games/${roomCode}/cards`)
        .send({ suit: legal[0].suit, value: legal[0].value });
    }
    await sleep(2_000);

    const played = await prisma.playedCard.findMany({
      where: { hand: { round: { gameRoom: { code: roomCode } } } },
    });

    // Only trick leaders may signal, and the backend enforces it.
    const signalled = played.filter((c) => c.signal !== null);
    expect(signalled.every((c) => c.position === 0)).toBe(true);

    // eslint-disable-next-line no-console -- the point of the diagnostic
    console.log(
      `[${TIER}] signals declared: ${signalled.length} of ` +
        `${played.filter((c) => c.position === 0).length} leads`,
      signalled.map((c) => `${c.value} di ${c.suit} [${c.signal}]`),
    );
  });
});
