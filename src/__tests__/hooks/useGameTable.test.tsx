import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGameTable } from "@/hooks/useGameTable";
import type { GameStateResponse, PlayerCard } from "@/game/model";

const mocks = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;

  const handlers = new Map<string, Handler>();

  return {
    apiGet: vi.fn<(path: string, signal?: AbortSignal) => Promise<unknown>>(),
    handlers,
    leaveRoom: vi.fn(),
    registerRoomHandlers: vi.fn(),
    unregisterRoom: vi.fn(),
  };
});

vi.mock("@/lib/api", () => ({
  apiGet: mocks.apiGet,
}));

vi.mock("@/sockets/roomHandlers", () => ({
  leaveRoom: mocks.leaveRoom,
  registerRoomHandlers: (...args: unknown[]) => {
    mocks.registerRoomHandlers(...args);
    return mocks.unregisterRoom;
  },
  subscribeToRoomEvent: (event: string, handler: (...args: unknown[]) => void) => {
    mocks.handlers.set(event, handler);
    return () => {
      if (mocks.handlers.get(event) === handler) {
        mocks.handlers.delete(event);
      }
    };
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

const myCard: PlayerCard = {
  id: 1,
  suit: "denara",
  value: "asso",
  playerId: 10,
  roundId: 20,
  inHand: true,
};

function gameState(
  overrides: Partial<GameStateResponse> = {},
): GameStateResponse {
  return {
    pausedAt: null,
    round: { id: 20, number: 1, briscola: "spade" },
    currentHandNumber: 1,
    callerUserId: 1,
    myCards: [myCard],
    currentTurnUserId: 2,
    playedCards: [],
    lastHandCards: [],
    totalPoints: {
      team0Points: 0,
      team1Points: 0,
      team0Figures: 0,
      team1Figures: 0,
    },
    turnTimer: null,
    isPractice: false,
    allHands: null,
    ...overrides,
    status: overrides.status ?? "playing",
    finishedGame: overrides.finishedGame ?? null,
  };
}

function emitSocket(event: string, payload: unknown) {
  const handler = mocks.handlers.get(event);
  if (!handler) {
    throw new Error(`No socket handler registered for ${event}`);
  }
  act(() => handler(payload));
}

function stateRequestCount() {
  return mocks.apiGet.mock.calls.filter(
    ([path]) => path === "/games/ROOM/state",
  ).length;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("useGameTable turn synchronization", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("reconciles state after the socket room join is acknowledged", async () => {
    const playedCard = {
      playerId: 12,
      userId: 2,
      suit: "coppe",
      value: "tre",
      position: 0,
      signal: "busso" as const,
      handNumber: 1,
    };
    mocks.apiGet
      .mockResolvedValueOnce(gameState({ currentTurnUserId: 2 }))
      .mockResolvedValueOnce(
        gameState({
          currentTurnUserId: 1,
          playedCards: [playedCard],
          turnTimer: {
            turnUserId: 1,
            remainingMs: 45_000,
            totalMs: 60_000,
            phase: "play_card",
          },
        }),
      )
      .mockResolvedValue({ playableCards: [myCard] });

    const { result } = renderHook(() =>
      useGameTable("ROOM", 1, "alice", [
        { userId: 1, username: "alice" },
        { userId: 2, username: "bob" },
      ]),
    );

    await waitFor(() => expect(result.current.currentTurnUserId).toBe(2));
    const onJoined = mocks.registerRoomHandlers.mock.calls[0]?.[2] as
      | (() => void)
      | undefined;
    expect(onJoined).toEqual(expect.any(Function));

    act(() => onJoined?.());

    await waitFor(() => expect(result.current.currentTurnUserId).toBe(1));
    expect(result.current.playedCards).toEqual([playedCard]);
    expect(result.current.currentSignal).toEqual({
      userId: 2,
      signal: "busso",
      cardKey: "coppe-tre",
    });
    expect(result.current.turnTimer).toMatchObject({
      turnUserId: 1,
      totalMs: 60_000,
      phase: "play_card",
    });
  });

  it("recovers the finished result when the game ends while disconnected", async () => {
    const finishedGame = {
      winnerTeam: 1,
      totalRounds: 4,
      finalScores: { team0: 18, team1: 22 },
      roundsWon: { team0: 1, team1: 3 },
    };
    mocks.apiGet
      .mockResolvedValueOnce(gameState({ currentTurnUserId: 2 }))
      .mockResolvedValueOnce(
        gameState({
          status: "finished",
          currentTurnUserId: null,
          finishedGame,
          turnTimer: null,
        }),
      );

    const { result } = renderHook(() =>
      useGameTable("ROOM", 1, "alice", [
        { userId: 1, username: "alice" },
        { userId: 2, username: "bob" },
      ]),
    );
    await waitFor(() => expect(result.current.currentTurnUserId).toBe(2));

    const onJoined = mocks.registerRoomHandlers.mock.calls[0]?.[2] as
      | (() => void)
      | undefined;
    act(() => onJoined?.());

    await waitFor(() =>
      expect(result.current.gameFinishedData).toEqual(finishedGame),
    );
    expect(result.current.currentTurnUserId).toBeNull();
    expect(result.current.turnTimer).toBeNull();
  });

  it("does not request playable cards while the game is paused", async () => {
    mocks.apiGet.mockResolvedValue(
      gameState({
        status: "paused",
        pausedAt: "2026-08-27T18:00:00.000Z",
        currentTurnUserId: 1,
        turnTimer: null,
        isPractice: true,
      }),
    );

    const { result } = renderHook(() =>
      useGameTable("ROOM", 1, "alice", [
        { userId: 1, username: "alice" },
      ]),
    );

    await waitFor(() => expect(result.current.gameStatus).toBe("paused"));
    expect(result.current.pausedAt).toBe("2026-08-27T18:00:00.000Z");
    expect(result.current.playableCards).toEqual([]);
    expect(
      mocks.apiGet.mock.calls.some(
        ([path]) => path === "/games/playable-cards/ROOM",
      ),
    ).toBe(false);
  });

  it("reconciles pause and resume events from another open tab", async () => {
    mocks.apiGet
      .mockResolvedValueOnce(gameState({ isPractice: true }))
      .mockResolvedValueOnce(
        gameState({
          status: "paused",
          pausedAt: "2026-08-27T18:00:00.000Z",
          isPractice: true,
        }),
      )
      .mockResolvedValueOnce(gameState({ isPractice: true }));

    const { result } = renderHook(() =>
      useGameTable("ROOM", 1, "alice", [
        { userId: 1, username: "alice" },
      ]),
    );
    await waitFor(() => expect(result.current.gameStatus).toBe("playing"));

    emitSocket("practice_paused", {
      roomCode: "ROOM",
      pausedAt: "2026-08-27T18:00:00.000Z",
    });
    await waitFor(() => expect(result.current.gameStatus).toBe("paused"));

    emitSocket("practice_resumed", { roomCode: "ROOM" });
    await waitFor(() => expect(result.current.gameStatus).toBe("playing"));
    expect(stateRequestCount()).toBe(3);
  });

  it("advances to my turn and fetches fresh playable cards", async () => {
    mocks.apiGet.mockImplementation((path) => {
      if (path === "/games/ROOM/state") {
        return Promise.resolve(gameState());
      }
      if (path === "/games/playable-cards/ROOM") {
        return Promise.resolve({ playableCards: [myCard] });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    const { result } = renderHook(() =>
      useGameTable("ROOM", 1, "alice", [
        { userId: 1, username: "alice" },
        { userId: 2, username: "bob" },
      ]),
    );

    await waitFor(() => expect(result.current.currentTurnUserId).toBe(2));
    expect(result.current.playableCards).toEqual([]);

    emitSocket("turn_timer_started", {
      turnUserId: 1,
      totalMs: 60_000,
      serverTimestamp: 1,
      phase: "play_card",
      isBot: false,
    });

    expect(result.current.currentTurnUserId).toBe(1);
    expect(result.current.playableCards).toEqual([]);
    await waitFor(() => expect(result.current.playableCards).toEqual([myCard]));
  });

  it("holds a completed trick across stale and new-round reconciliation", async () => {
    let stateCalls = 0;
    const playedCards = [0, 1].map((position) => ({
      playerId: position + 10,
      userId: position + 1,
      suit: "coppe",
      value: "due",
      position,
      handNumber: 1,
    }));

    mocks.apiGet.mockImplementation((path) => {
      if (path === "/games/ROOM/state") {
        stateCalls += 1;
        return Promise.resolve(
          gameState({
            round:
              stateCalls === 1
                ? { id: 20, number: 1, briscola: "spade" }
                : { id: 21, number: 2, briscola: "denara" },
            currentTurnUserId: 1,
            playedCards: stateCalls === 1 ? playedCards : [],
          }),
        );
      }
      if (path === "/games/playable-cards/ROOM") {
        return Promise.resolve({ playableCards: [myCard] });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    const { result } = renderHook(() =>
      useGameTable("ROOM", 1, "alice", [
        { userId: 1, username: "alice" },
        { userId: 2, username: "bob" },
        { userId: 3, username: "carla" },
        { userId: 4, username: "diego" },
      ]),
    );

    await waitFor(() => expect(result.current.playableCards).toEqual([myCard]));
    vi.useFakeTimers();

    emitSocket("card_played", {
      playerId: 12,
      userId: 3,
      suit: "bastoni",
      value: "cavallo",
      position: 2,
      handNumber: 1,
      signal: null,
    });
    emitSocket("card_played", {
      playerId: 13,
      userId: 4,
      suit: "spade",
      value: "re",
      position: 3,
      handNumber: 1,
      signal: null,
    });
    emitSocket("new_round_started", {
      roundId: 21,
      roundNumber: 2,
      callerUserId: 1,
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.playedCards).toHaveLength(4);
    expect(result.current.playableCards).toEqual([]);
    expect(result.current.currentRound?.id).toBe(21);
    expect(stateCalls).toBe(2);

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(stateCalls).toBe(2);
    expect(result.current.playedCards).toHaveLength(4);

    act(() => vi.advanceTimersByTime(2_699));
    expect(result.current.playedCards).toHaveLength(4);
    expect(result.current.playableCards).toEqual([]);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(stateCalls).toBe(3);
    expect(result.current.playedCards).toEqual([]);
    expect(result.current.playableCards).toEqual([myCard]);
  });

  it("keeps queued cards and signals together without restarting the visible trick's hold", async () => {
    const cardsFor = (handNumber: number, signal: "busso" | "striscio") =>
      [0, 1, 2, 3].map((position) => ({
        playerId: position + 10,
        userId: position + 1,
        suit: handNumber === 1 ? "coppe" : "spade",
        value: ["asso", "tre", "re", "sette"][position],
        position,
        handNumber,
        signal: position === 0 ? signal : null,
      }));
    const firstTrick = cardsFor(1, "busso");
    const secondTrick = cardsFor(2, "striscio");
    let playedCards = firstTrick.slice(0, 3);
    mocks.apiGet.mockImplementation((path) =>
      Promise.resolve(
        path === "/games/ROOM/state"
          ? gameState({ playedCards, currentTurnUserId: 4 })
          : { playableCards: [myCard] },
      ),
    );
    const { result } = renderHook(() =>
      useGameTable("ROOM", 1, "alice", []),
    );
    await waitFor(() => expect(result.current.playedCards).toHaveLength(3));
    vi.useFakeTimers();

    emitSocket("card_played", firstTrick[3]);
    act(() => vi.advanceTimersByTime(1_000));
    playedCards = secondTrick;
    secondTrick.forEach((card) => emitSocket("card_played", card));
    emitSocket("turn_timer_started", {
      turnUserId: 4,
      totalMs: 60_000,
      serverTimestamp: 1,
      phase: "play_card",
      isBot: false,
    });

    expect(result.current.playedCards).toEqual(firstTrick);
    expect(result.current.currentSignal).toMatchObject({ signal: "busso" });
    expect(result.current.currentTurnUserId).toBeNull();
    expect(result.current.turnTimer).toBeNull();
    expect(result.current.playableCards).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_999);
    });
    expect(result.current.playedCards).toEqual(firstTrick);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.playedCards).toEqual(secondTrick);
    expect(result.current.currentSignal).toMatchObject({ signal: "striscio" });
    expect(result.current.currentTurnUserId).toBeNull();

    playedCards = [];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(result.current.playedCards).toEqual([]);
    expect(result.current.currentSignal).toBeNull();
    expect(result.current.currentTurnUserId).toBe(4);
  });

  it("shows the next caller while the new-round state fetch is pending", async () => {
    const nextRoundState = deferred<GameStateResponse>();
    mocks.apiGet
      .mockResolvedValueOnce(gameState({ currentTurnUserId: 2 }))
      .mockImplementationOnce(() => nextRoundState.promise);

    const { result } = renderHook(() =>
      useGameTable("ROOM", 1, "alice", [
        { userId: 1, username: "alice" },
        { userId: 2, username: "bob" },
      ]),
    );
    await waitFor(() => expect(result.current.currentTurnUserId).toBe(2));

    emitSocket("new_round_started", {
      roundId: 21,
      roundNumber: 2,
      callerUserId: 1,
    });

    expect(result.current.currentRound).toEqual({
      id: 21,
      number: 2,
      briscola: null,
      cricca: false,
    });
    expect(result.current.callerUserId).toBe(1);
    expect(result.current.currentTurnUserId).toBe(1);
    expect(result.current.playedCards).toEqual([]);
  });

  it("unsubscribes events and cancels delayed reconciliation on unmount", async () => {
    mocks.apiGet.mockImplementation((path) => {
      if (path === "/games/ROOM/state") {
        return Promise.resolve(gameState({ currentTurnUserId: 2 }));
      }
      if (path === "/games/playable-cards/ROOM") {
        return Promise.resolve({ playableCards: [myCard] });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    const { result, unmount } = renderHook(() =>
      useGameTable("ROOM", 1, "alice", [
        { userId: 1, username: "alice" },
        { userId: 2, username: "bob" },
      ]),
    );

    await waitFor(() => expect(result.current.currentTurnUserId).toBe(2));
    expect(stateRequestCount()).toBe(1);
    vi.useFakeTimers();

    act(() => {
      emitSocket("card_played", {
        playerId: 12,
        userId: 2,
        suit: "coppe",
        value: "tre",
        position: 0,
        handNumber: 1,
        signal: null,
      });
    });

    unmount();
    expect(mocks.handlers.size).toBe(0);
    expect(mocks.unregisterRoom).toHaveBeenCalledOnce();
    expect(mocks.leaveRoom).toHaveBeenCalledWith("ROOM");

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(stateRequestCount()).toBe(1);
  });

  it("cancels table reads before leaving and restores them if leaving fails", async () => {
    const pendingCards = deferred<{ playableCards: PlayerCard[] }>();
    const pendingState = deferred<GameStateResponse>();
    mocks.apiGet.mockImplementation((path) => {
      if (path === "/games/ROOM/state") {
        return stateRequestCount() === 1
          ? Promise.resolve(gameState({ currentTurnUserId: 1 }))
          : pendingState.promise;
      }
      return pendingCards.promise;
    });
    const { result } = renderHook(() =>
      useGameTable("ROOM", 1, "alice", []),
    );
    await waitFor(() => expect(result.current.currentTurnUserId).toBe(1));
    act(() => { void result.current.refetchGameState(); });
    const signals = mocks.apiGet.mock.calls.map(([, signal]) => signal);
    expect(signals.every((signal) => signal && !signal.aborted)).toBe(true);

    act(() => result.current.setRequestsEnabled(false));
    expect(signals.every((signal) => signal?.aborted)).toBe(true);
    const countBeforeLeaving = mocks.apiGet.mock.calls.length;
    emitSocket("turn_timer_started", {
      turnUserId: 1, totalMs: 60_000, phase: "play_card", isBot: false,
    });
    await act(async () => { await result.current.refetchGameState(); });
    expect(mocks.apiGet).toHaveBeenCalledTimes(countBeforeLeaving);

    await act(async () => {
      pendingCards.resolve({ playableCards: [myCard] });
      pendingState.resolve(gameState({ currentTurnUserId: 3 }));
    });
    expect(result.current.playableCards).toEqual([]);
    expect(result.current.currentTurnUserId).toBe(1);

    mocks.apiGet.mockResolvedValue(gameState({ currentTurnUserId: 2 }));
    act(() => result.current.setRequestsEnabled(true));
    await waitFor(() => expect(result.current.currentTurnUserId).toBe(2));
    expect(mocks.apiGet.mock.lastCall?.[1]?.aborted).toBe(false);
  });

  it("cancels pending reads on remote abandonment and on unmount in StrictMode", async () => {
    mocks.apiGet.mockResolvedValue(gameState());
    const { result, unmount } = renderHook(
      () => useGameTable("ROOM", 1, "alice", []),
      { wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> },
    );
    await waitFor(() => expect(result.current.gameStateStatus).toBe("ready"));
    const signal = mocks.apiGet.mock.lastCall?.[1];
    expect(signal?.aborted).toBe(false);
    emitSocket("practice_abandoned", { roomCode: "OTHER" });
    expect(signal?.aborted).toBe(false);
    emitSocket("practice_abandoned", { roomCode: "ROOM" });
    expect(signal?.aborted).toBe(true);

    act(() => result.current.setRequestsEnabled(true));
    const resumedSignal = mocks.apiGet.mock.lastCall?.[1];
    expect(resumedSignal?.aborted).toBe(false);
    unmount();
    expect(resumedSignal?.aborted).toBe(true);
    const count = mocks.apiGet.mock.calls.length;
    act(() => result.current.setRequestsEnabled(true));
    expect(mocks.apiGet).toHaveBeenCalledTimes(count);
  });

  it("ignores a state request failure after unmount", async () => {
    const pending = deferred<GameStateResponse>();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.apiGet
      .mockResolvedValueOnce(gameState({ currentTurnUserId: 2 }))
      .mockImplementationOnce(() => pending.promise);

    const { result, unmount } = renderHook(() =>
      useGameTable("ROOM", 1, "alice", [
        { userId: 1, username: "alice" },
        { userId: 2, username: "bob" },
      ]),
    );

    await waitFor(() => expect(result.current.currentTurnUserId).toBe(2));
    emitSocket("practice_paused", { roomCode: "ROOM" });
    await waitFor(() => expect(stateRequestCount()).toBe(2));

    unmount();
    await act(async () => {
      pending.reject(new TypeError("Failed to fetch"));
      await Promise.resolve();
    });

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("ignores a stale game-state response that resolves out of order", async () => {
    const older = deferred<GameStateResponse>();
    const newer = deferred<GameStateResponse>();
    let requestCount = 0;
    mocks.apiGet.mockImplementation((path) => {
      if (path === "/games/ROOM/state") {
        requestCount += 1;
        return requestCount === 1 ? older.promise : newer.promise;
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    const { result } = renderHook(() =>
      useGameTable("ROOM", 1, "alice", [
        { userId: 1, username: "alice" },
        { userId: 2, username: "bob" },
      ]),
    );
    await waitFor(() => expect(stateRequestCount()).toBe(1));

    let newerRequest!: Promise<void>;
    act(() => {
      newerRequest = result.current.refetchGameState();
    });
    await waitFor(() => expect(stateRequestCount()).toBe(2));

    await act(async () => {
      newer.resolve(gameState({ currentTurnUserId: 2 }));
      await newerRequest;
    });
    expect(result.current.currentTurnUserId).toBe(2);

    await act(async () => {
      older.resolve(gameState({ currentTurnUserId: 3 }));
      await Promise.resolve();
    });
    expect(result.current.currentTurnUserId).toBe(2);
  });

  it("does not let an older state response erase a game-finished event", async () => {
    const stale = deferred<GameStateResponse>();
    mocks.apiGet
      .mockResolvedValueOnce(gameState({ currentTurnUserId: 2 }))
      .mockImplementationOnce(() => stale.promise)
      .mockImplementation((path) => {
        if (path === "/games/playable-cards/ROOM") {
          return Promise.resolve({ playableCards: [myCard] });
        }
        return Promise.reject(new Error(`Unexpected request: ${path}`));
      });

    const { result } = renderHook(() =>
      useGameTable("ROOM", 1, "alice", [
        { userId: 1, username: "alice" },
        { userId: 2, username: "bob" },
      ]),
    );
    await waitFor(() => expect(result.current.currentTurnUserId).toBe(2));

    act(() => {
      void result.current.refetchGameState();
    });
    await waitFor(() => expect(stateRequestCount()).toBe(2));

    emitSocket("game_finished", {
      winnerTeam: 0,
      totalRounds: 3,
      finalScores: { team0: 15, team1: 11 },
      roundsWon: { team0: 2, team1: 1 },
    });
    expect(result.current.gameFinishedData?.winnerTeam).toBe(0);

    await act(async () => {
      stale.resolve(gameState({ currentTurnUserId: 3 }));
      await Promise.resolve();
    });

    expect(result.current.gameFinishedData?.winnerTeam).toBe(0);
    expect(result.current.currentTurnUserId).toBe(2);
  });

  it("keeps newer card and timer events when an older state response arrives", async () => {
    const stale = deferred<GameStateResponse>();
    mocks.apiGet
      .mockResolvedValueOnce(gameState({ currentTurnUserId: 2 }))
      .mockImplementationOnce(() => stale.promise)
      .mockImplementation((path) => {
        if (path === "/games/playable-cards/ROOM") {
          return Promise.resolve({ playableCards: [myCard] });
        }
        return Promise.reject(new Error(`Unexpected request: ${path}`));
      });

    const { result } = renderHook(() =>
      useGameTable("ROOM", 1, "alice", [
        { userId: 1, username: "alice" },
        { userId: 2, username: "bob" },
      ]),
    );
    await waitFor(() => expect(result.current.currentTurnUserId).toBe(2));

    act(() => {
      void result.current.refetchGameState();
    });
    await waitFor(() => expect(stateRequestCount()).toBe(2));

    emitSocket("card_played", {
      playerId: 12,
      userId: 2,
      suit: "coppe",
      value: "tre",
      position: 0,
      handNumber: 1,
      signal: "busso",
    });
    emitSocket("turn_timer_started", {
      turnUserId: 1,
      totalMs: 60_000,
      serverTimestamp: 1,
      phase: "play_card",
      isBot: false,
    });

    await act(async () => {
      stale.resolve(gameState({ currentTurnUserId: 2, playedCards: [] }));
      await Promise.resolve();
    });

    expect(result.current.playedCards).toHaveLength(1);
    expect(result.current.currentSignal).toEqual({
      userId: 2,
      signal: "busso",
      cardKey: "coppe-tre",
    });
    expect(result.current.currentTurnUserId).toBe(1);
  });

  it("keeps loaded state usable when join reconciliation fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.apiGet
      .mockResolvedValueOnce(gameState({ currentTurnUserId: 2 }))
      .mockRejectedValueOnce(new Error("temporary network failure"));

    const { result } = renderHook(() =>
      useGameTable("ROOM", 1, "alice", [
        { userId: 1, username: "alice" },
        { userId: 2, username: "bob" },
      ]),
    );
    await waitFor(() => expect(result.current.gameStateStatus).toBe("ready"));

    const onJoined = mocks.registerRoomHandlers.mock.calls[0]?.[2] as
      | (() => void)
      | undefined;
    act(() => onJoined?.());

    await waitFor(() => expect(stateRequestCount()).toBe(2));
    expect(result.current.gameStateStatus).toBe("ready");
    expect(result.current.currentTurnUserId).toBe(2);
    consoleError.mockRestore();
  });

  it("exposes a retryable error when game-state loading fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.apiGet
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(gameState({ currentTurnUserId: 2 }));

    const { result } = renderHook(() =>
      useGameTable("ROOM", 1, "alice", [
        { userId: 1, username: "alice" },
        { userId: 2, username: "bob" },
      ]),
    );

    await waitFor(() => expect(result.current.gameStateStatus).toBe("error"));

    await act(async () => {
      await result.current.refetchGameState();
    });

    expect(result.current.gameStateStatus).toBe("ready");
    expect(result.current.currentTurnUserId).toBe(2);
    consoleError.mockRestore();
  });
});
