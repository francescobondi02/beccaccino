import {
  clearTurnTimer,
  getTurnTimerState,
  hasTurnRuntime,
  scheduleTurnTimer,
} from "../../src/runtime/turnTimer";
import { startRuntimeTurn } from "../../src/runtime/turnRuntime";
import { clearBotSeats, registerBotSeats } from "../../src/runtime/botRegistry";

const firstTurn = {
  roundId: 10,
  handId: 20,
  playedCardCount: 0,
};

describe("turn timer storage", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    clearTurnTimer("ROOM01");
    clearBotSeats("ROOM01");
    jest.useRealTimers();
  });

  it.each(["play_card", "choose_briscola"] as const)(
    "preserves human play time and adds presentation time before %s",
    (phase) => {
      registerBotSeats("ROOM01", [{ userId: 2, tier: "forte" }]);
      startRuntimeTurn("ROOM01", 2, phase, 0, firstTurn);
      const botDuration = getTurnTimerState("ROOM01")!.totalMs;
      startRuntimeTurn("ROOM01", 2, phase, 0, firstTurn, 3_000);
      expect(getTurnTimerState("ROOM01")!.totalMs).toBe(botDuration + 3_000);

      startRuntimeTurn("ROOM01", 1, phase, 0, firstTurn);
      const humanDuration = getTurnTimerState("ROOM01")!.totalMs;
      startRuntimeTurn("ROOM01", 1, phase, 0, firstTurn, 3_000);
      expect(getTurnTimerState("ROOM01")!.totalMs).toBe(
        humanDuration + (phase === "choose_briscola" ? 3_000 : 0),
      );
    },
  );

  it("replaces a room timer and runs only the latest callback", async () => {
    const first = jest.fn();
    const second = jest.fn();
    scheduleTurnTimer({
      roomCode: "ROOM01",
      userId: 1,
      phase: "choose_briscola",
      pauseEpoch: 0,
      identity: { roundId: 10, handId: null, playedCardCount: 0 },
      durationMs: 100,
      isBot: false,
      onElapsed: first,
    });
    scheduleTurnTimer({
      roomCode: "ROOM01",
      userId: 2,
      phase: "play_card",
      pauseEpoch: 1,
      identity: firstTurn,
      durationMs: 50,
      isBot: true,
      onElapsed: second,
    });

    await jest.advanceTimersByTimeAsync(100);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(getTurnTimerState("ROOM01")).toBeNull();
  });

  it("matches the full persisted turn identity", () => {
    scheduleTurnTimer({
      roomCode: "ROOM01",
      userId: 2,
      phase: "play_card",
      pauseEpoch: 4,
      identity: firstTurn,
      durationMs: 100,
      isBot: false,
      onElapsed: jest.fn(),
    });

    expect(hasTurnRuntime("ROOM01", 2, "play_card", 4, firstTurn)).toBe(
      true,
    );
    expect(hasTurnRuntime("ROOM01", 2, "play_card", 3, firstTurn)).toBe(
      false,
    );
    expect(hasTurnRuntime("ROOM01", 3, "play_card", 4, firstTurn)).toBe(
      false,
    );
    expect(
      hasTurnRuntime("ROOM01", 2, "play_card", 4, {
        ...firstTurn,
        playedCardCount: 1,
      }),
    ).toBe(false);
  });

  it("retains turn ownership until asynchronous execution completes", async () => {
    let finish!: () => void;
    const onElapsed = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    scheduleTurnTimer({
      roomCode: "ROOM01",
      userId: 2,
      phase: "play_card",
      pauseEpoch: 4,
      identity: firstTurn,
      durationMs: 100,
      isBot: true,
      onElapsed,
    });

    jest.advanceTimersByTime(100);
    await Promise.resolve();

    expect(onElapsed).toHaveBeenCalledTimes(1);
    expect(hasTurnRuntime("ROOM01", 2, "play_card", 4, firstTurn)).toBe(
      true,
    );

    finish();
    await Promise.resolve();
    await Promise.resolve();

    expect(getTurnTimerState("ROOM01")).toBeNull();
  });

  it("removes failed ownership before invoking the rearm callback", async () => {
    const onFailed = jest.fn(() => {
      expect(getTurnTimerState("ROOM01")).toBeNull();
      scheduleTurnTimer({
        roomCode: "ROOM01",
        userId: 2,
        phase: "play_card",
        pauseEpoch: 4,
        identity: firstTurn,
        durationMs: 200,
        isBot: true,
        onElapsed: jest.fn(),
      });
    });
    scheduleTurnTimer({
      roomCode: "ROOM01",
      userId: 2,
      phase: "play_card",
      pauseEpoch: 4,
      identity: firstTurn,
      durationMs: 100,
      isBot: true,
      onElapsed: async () => {
        throw new Error("execution failed");
      },
      onFailed,
    });

    await jest.advanceTimersByTimeAsync(100);

    expect(onFailed).toHaveBeenCalledWith(expect.any(Error));
    expect(hasTurnRuntime("ROOM01", 2, "play_card", 4, firstTurn)).toBe(
      true,
    );
  });
});
