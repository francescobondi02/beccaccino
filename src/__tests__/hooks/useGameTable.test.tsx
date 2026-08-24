import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useGameTable,
  type GameStateResponse,
  type PlayerCard,
} from "@/hooks/useGameTable";

const mocks = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  type ConnectionStatus = "connected" | "disconnected" | "reconnecting";

  const handlers = new Map<string, Handler>();
  const statusListeners = new Set<
    (status: ConnectionStatus) => void
  >();
  const socket = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
    }),
    off: vi.fn((event: string, handler?: Handler) => {
      if (!handler || handlers.get(event) === handler) {
        handlers.delete(event);
      }
    }),
  };

  return {
    apiGet: vi.fn<(path: string) => Promise<unknown>>(),
    handlers,
    statusListeners,
    socket,
    registerRoomHandlers: vi.fn(),
    unsubscribeErrorToast: vi.fn(),
  };
});

vi.mock("@/lib/api", () => ({
  apiGet: mocks.apiGet,
}));

vi.mock("@/sockets/roomHandlers", () => ({
  registerRoomHandlers: mocks.registerRoomHandlers,
}));

vi.mock("@/sockets/socketClient", () => ({
  getSocket: () => mocks.socket,
  onConnectionStatusChange: (
    listener: (
      status: "connected" | "disconnected" | "reconnecting"
    ) => void,
  ) => {
    mocks.statusListeners.add(listener);
    return () => mocks.statusListeners.delete(listener);
  },
  registerErrorToast: () => mocks.unsubscribeErrorToast,
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
    mocks.statusListeners.clear();
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

  it("refetches authoritative state after reconnecting", async () => {
    let stateCalls = 0;
    mocks.apiGet.mockImplementation((path) => {
      if (path === "/games/ROOM/state") {
        stateCalls += 1;
        return Promise.resolve(
          gameState({ currentTurnUserId: stateCalls === 1 ? 2 : 1 }),
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
      ]),
    );

    await waitFor(() => expect(result.current.currentTurnUserId).toBe(2));

    act(() => {
      mocks.statusListeners.forEach((listener) => listener("disconnected"));
      mocks.statusListeners.forEach((listener) => listener("reconnecting"));
    });
    expect(stateRequestCount()).toBe(1);

    act(() => {
      mocks.statusListeners.forEach((listener) => listener("connected"));
    });

    await waitFor(() => expect(result.current.currentTurnUserId).toBe(1));
    expect(stateRequestCount()).toBe(2);
  });
});
