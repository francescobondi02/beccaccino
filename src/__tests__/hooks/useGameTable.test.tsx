import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGameTable } from "@/hooks/useGameTable";
import type { GameStateResponse, PlayerCard } from "@/game/model";

const mocks = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;

  const handlers = new Map<string, Handler>();

  return {
    apiGet: vi.fn<(path: string) => Promise<unknown>>(),
    handlers,
    registerRoomHandlers: vi.fn(),
    unregisterRoom: vi.fn(),
  };
});

vi.mock("@/lib/api", () => ({
  apiGet: mocks.apiGet,
}));

vi.mock("@/sockets/roomHandlers", () => ({
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

  it("advances a completed trick before the delayed REST reconciliation", async () => {
    let stateCalls = 0;
    const playedCards = [0, 1, 2].map((position) => ({
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
            currentTurnUserId: stateCalls === 1 ? 1 : 2,
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
      playerId: 13,
      userId: 4,
      suit: "spade",
      value: "re",
      position: 3,
      handNumber: 1,
      signal: null,
    });
    emitSocket("turn_timer_started", {
      turnUserId: 1,
      totalMs: 60_000,
      serverTimestamp: 2,
      phase: "play_card",
      isBot: false,
    });

    expect(result.current.playedCards).toHaveLength(4);
    expect(result.current.currentTurnUserId).toBe(1);
    expect(result.current.playableCards).toEqual([]);

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.playableCards).toEqual([myCard]);

    act(() => vi.advanceTimersByTime(2_999));
    expect(stateCalls).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(stateCalls).toBe(2);
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

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(stateRequestCount()).toBe(1);
  });
});
