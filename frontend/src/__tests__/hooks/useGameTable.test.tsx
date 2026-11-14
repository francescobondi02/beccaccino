import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { notifyManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameState, PlayedCard } from "@contract/game";
import { useGameTable } from "@/hooks/useGameTable";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn<(path: string, signal?: AbortSignal) => Promise<unknown>>(),
  handlers: new Map<string, (payload: unknown) => void>(),
  onJoined: null as (() => void) | null,
  leaveRoom: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ apiGet: mocks.apiGet }));

vi.mock("@/sockets/roomHandlers", () => ({
  leaveRoom: mocks.leaveRoom,
  registerRoomHandlers: (_roomCode: string, onJoined: () => void) => {
    mocks.onJoined = onJoined;
    return vi.fn();
  },
}));

vi.mock("@/sockets/socketClient", () => ({
  subscribe: (event: string, handler: (payload: unknown) => void) => {
    mocks.handlers.set(event, handler);
    return () => mocks.handlers.delete(event);
  },
}));

const lead: PlayedCard = { userId: 2, suit: "coppe", value: "tre", signal: null };

function gameState(overrides: Partial<GameState> = {}): GameState {
  return {
    roomCode: "ROOM",
    version: 1,
    serverTime: new Date().toISOString(),
    status: "playing",
    isPractice: false,
    players: ["alice", "bob", "carla", "diego"].map((username, seat) => ({
      userId: seat + 1, username, isBot: false, seat, team: seat % 2 === 0 ? 0 : 1,
      botModel: null, abandoned: false,
    })),
    round: { number: 1, callerUserId: 1, briscola: "spade", cricca: false, deal: null },
    trick: { number: 1, cards: [] },
    lastTrick: null,
    myHand: [{ suit: "denara", value: "asso" }],
    playableCards: [],
    turn: { userId: 2, phase: "play_card", startedAt: new Date().toISOString(), deadline: null },
    score: { team0: { points: 0, figures: 0 }, team1: { points: 0, figures: 0 } },
    roundSummary: null,
    result: null,
    lastAction: null,
    ...overrides,
  };
}

function cardPlayed(version: number, card: PlayedCard = lead): GameState {
  return gameState({
    version,
    trick: { number: 1, cards: [card] },
    lastAction: {
      kind: "card_played", userId: card.userId, card: { suit: card.suit, value: card.value },
      signal: card.signal, source: "human", takeover: false,
    },
  });
}

// Notify observers synchronously instead of on a timeout.
notifyManager.setScheduler((callback) => callback());

function push(state: GameState) {
  act(() => mocks.handlers.get("game_state")!(state));
}

function renderTable() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useGameTable("ROOM", 1), { wrapper });
}

describe("useGameTable", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("ignores a lower version and animates an equal version only once", async () => {
    mocks.apiGet.mockResolvedValue(gameState());
    const { result } = renderTable();
    await waitFor(() => expect(result.current.gameState?.version).toBe(1));

    push(cardPlayed(3));
    const animatedCard = result.current.animatedCard;
    expect(animatedCard).toEqual(lead);

    push(cardPlayed(2, { ...lead, value: "due" }));
    expect(result.current.playedCards).toEqual([lead]);

    push(cardPlayed(3));
    expect(result.current.animatedCard).toBe(animatedCard);
  });

  it("keeps a newer push when a slower refetch resolves with an older state", async () => {
    mocks.apiGet.mockResolvedValue(gameState());
    const { result } = renderTable();
    await waitFor(() => expect(result.current.gameState?.version).toBe(1));

    let finishRefetch!: (state: GameState) => void;
    mocks.apiGet.mockReturnValue(new Promise((resolve) => { finishRefetch = resolve; }));
    act(() => mocks.onJoined!());
    push(cardPlayed(4));
    await act(async () => finishRefetch(gameState({ version: 2 })));

    expect(result.current.gameState?.version).toBe(4);
    expect(result.current.playedCards).toEqual([lead]);
  });

  it("shows a completed trick until onTableUntil, without turn or playable cards", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const cards = [1, 2, 3, 4].map((userId) => ({ ...lead, userId }));
    mocks.apiGet.mockResolvedValue(gameState({
      trick: null,
      playableCards: [{ suit: "denara", value: "asso" }],
      turn: { userId: 1, phase: "play_card", startedAt: new Date().toISOString(), deadline: null },
      lastTrick: {
        roundNumber: 1, trickNumber: 1, winnerUserId: 1, cards,
        onTableUntil: new Date(Date.now() + 2000).toISOString(),
      },
    }));
    const { result } = renderTable();
    await waitFor(() => expect(result.current.completedTrick).not.toBeNull());
    expect(result.current.playedCards).toEqual(cards);
    expect(result.current.currentTurnUserId).toBeNull();
    expect(result.current.playableCards).toEqual([]);

    act(() => vi.advanceTimersByTime(2100));
    expect(result.current.completedTrick).toBeNull();
    expect(result.current.currentTurnUserId).toBe(1);
    expect(result.current.playableCards).toHaveLength(1);
  });

  it("holds the next trick's lead card until the completed trick leaves the table", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const cards = [2, 3, 4, 1].map((userId, index) => ({ ...lead, userId, value: (["tre", "due", "re", "asso"] as const)[index] }));
    const lastTrick = {
      roundNumber: 1, trickNumber: 1, winnerUserId: 1, cards,
      onTableUntil: new Date(Date.now() + 2000).toISOString(),
    };
    mocks.apiGet.mockResolvedValue(gameState());
    const { result } = renderTable();
    await waitFor(() => expect(result.current.gameState).toBeDefined());

    push({ ...cardPlayed(2, cards[3]), trick: null, lastTrick });
    const completing = result.current.animatedCard;
    expect(completing).toEqual(cards[3]);

    const nextLead: PlayedCard = { userId: 1, suit: "denara", value: "sette", signal: null };
    push({ ...cardPlayed(3, nextLead), trick: { number: 2, cards: [nextLead] }, lastTrick });
    expect(result.current.animatedCard).toBe(completing);

    act(() => vi.advanceTimersByTime(2100));
    expect(result.current.animatedCard).toEqual(nextLead);
  });

  it("announces automatic plays and refetches on room_changed", async () => {
    mocks.apiGet.mockResolvedValue(gameState());
    const { result } = renderTable();
    await waitFor(() => expect(result.current.gameState).toBeDefined());

    push(gameState({
      version: 2,
      lastAction: {
        kind: "card_played", userId: 2, card: lead, signal: null, source: "timeout", takeover: false,
      },
    }));
    expect(result.current.notice).toBe("bob: tempo scaduto, carta giocata automaticamente.");

    act(() => mocks.handlers.get("room_changed")!({ roomCode: "ROOM" }));
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledTimes(2));
    expect(mocks.apiGet).toHaveBeenLastCalledWith("/games/ROOM/state", expect.any(AbortSignal));
  });
});
