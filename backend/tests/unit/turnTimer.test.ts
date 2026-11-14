import {
  clearTurnTimer,
  getTurnTimerState,
  isTimerArmed,
  scheduleTurnTimer,
} from "../../src/runtime/turnTimer";
import { armTurn } from "../../src/runtime/turnRuntime";
import { toGameState } from "../../src/game/gameState";
import { roundDealTimes } from "../../src/gameConfig";
import type { LiveGame } from "../../src/game/liveGame";

function liveGame(botModel: string | null, trickCards: number, lastTrickAt: Date | null): LiveGame {
  const players = [0, 1, 2, 3].map((seat) => ({
    id: seat + 1,
    userId: seat + 1,
    username: `p${seat}`,
    isBot: false,
    seat,
    team: seat % 2,
    botModel: seat === 0 ? botModel : null,
    abandonedAt: null,
    timeoutCount: 0,
  }));
  const trick = {
    id: 1, number: 2, starterId: trickCards ? 4 : 1, winnerId: null, completedAt: null,
    cards: Array.from({ length: trickCards }, () => ({ playerId: 2, suit: "coppe", value: "re", signal: null })),
  } as LiveGame["trick"];
  return {
    room: {
      id: 1, code: "ROOM01", isPractice: false, started: true, pausedAt: null, finished: false,
      winnerTeam: null, version: 7, turnStartedAt: new Date(Date.now() - 10_000),
      botTier: null,
    },
    players,
    round: { id: 1, number: 1, callerId: 1, briscola: "coppe", cricca: false, createdAt: new Date(0), tricks: [] },
    hands: new Map(),
    trick,
    lastTrick: lastTrickAt
      ? { ...trick!, cards: [], winnerId: 1, completedAt: lastTrickAt, roundNumber: 1 }
      : null,
    roundScores: [],
    result: null,
  };
}

describe("turn timer storage", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    process.env.TURN_TIMEOUT_SECONDS = "60";
    process.env.BOT_THINK_DELAY_MS = "1000";
  });

  afterEach(() => {
    clearTurnTimer("ROOM01");
    jest.useRealTimers();
  });

  it("arms a human turn for its deadline and a bot turn after the finished trick is shown", () => {
    armTurn(liveGame(null, 0, new Date()));
    expect(getTurnTimerState("ROOM01")).toEqual({ version: 7, remainingMs: 50_000 });

    armTurn(liveGame("forte", 0, new Date()));
    expect(getTurnTimerState("ROOM01")!.remainingMs).toBe(4_000);

    armTurn(liveGame("forte", 1, new Date()));
    expect(getTurnTimerState("ROOM01")!.remainingMs).toBe(1_000);
  });

  it("starts the briscola turn when the deal presentation ends", () => {
    const game = liveGame(null, 0, null);
    game.round = { ...game.round!, briscola: null, createdAt: new Date() };
    const { reviewEndsAt } = roundDealTimes(game.round);
    expect(reviewEndsAt).toBeGreaterThan(game.room.turnStartedAt!.getTime());

    armTurn(game);
    expect(getTurnTimerState("ROOM01")!.remainingMs).toBe(reviewEndsAt + 90_000 - Date.now());
    expect(toGameState(game, 1, Date.now(), null).turn).toMatchObject({
      phase: "choose_briscola",
      startedAt: new Date(reviewEndsAt).toISOString(),
      deadline: new Date(reviewEndsAt + 90_000).toISOString(),
    });
  });

  it("replaces a room timer and runs only the latest callback", async () => {
    const first = jest.fn(async () => undefined);
    const second = jest.fn(async () => undefined);
    scheduleTurnTimer("ROOM01", 1, 100, first);
    scheduleTurnTimer("ROOM01", 2, 50, second);

    await jest.advanceTimersByTimeAsync(100);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(getTurnTimerState("ROOM01")).toBeNull();
  });

  it("matches the armed version", () => {
    scheduleTurnTimer("ROOM01", 4, 100, async () => undefined);
    expect(isTimerArmed("ROOM01", 4)).toBe(true);
    expect(isTimerArmed("ROOM01", 5)).toBe(false);
  });

  it("drops a failed timer so the reconciler re-arms the room", async () => {
    scheduleTurnTimer("ROOM01", 4, 100, async () => {
      throw new Error("execution failed");
    });

    await jest.advanceTimersByTimeAsync(100);

    expect(isTimerArmed("ROOM01", 4)).toBe(false);
  });
});
