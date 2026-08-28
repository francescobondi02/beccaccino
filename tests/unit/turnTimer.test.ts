import {
  clearTurnTimer,
  getTurnTimerState,
  hasScheduledTurn,
  scheduleTurnTimer,
} from "../../src/runtime/turnTimer";

describe("turn timer storage", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    clearTurnTimer("ROOM01");
    jest.useRealTimers();
  });

  it("replaces a room timer and runs only the latest callback", async () => {
    const first = jest.fn();
    const second = jest.fn();
    scheduleTurnTimer({
      roomCode: "ROOM01",
      userId: 1,
      phase: "choose_briscola",
      pauseEpoch: 0,
      durationMs: 100,
      isBot: false,
      onElapsed: first,
    });
    scheduleTurnTimer({
      roomCode: "ROOM01",
      userId: 2,
      phase: "play_card",
      pauseEpoch: 1,
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
      durationMs: 100,
      isBot: false,
      onElapsed: jest.fn(),
    });

    expect(hasScheduledTurn("ROOM01", 2, "play_card", 4)).toBe(true);
    expect(hasScheduledTurn("ROOM01", 2, "play_card", 3)).toBe(false);
    expect(hasScheduledTurn("ROOM01", 3, "play_card", 4)).toBe(false);
  });
});
