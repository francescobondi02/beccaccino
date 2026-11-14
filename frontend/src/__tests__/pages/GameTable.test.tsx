import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { GameState } from "@contract/game";
import GameTable from "@/pages/GameTable";
import { ApiError } from "@/lib/api";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn<(path: string) => Promise<unknown>>(),
  apiPost: vi.fn(),
}));

vi.mock("@/lib/api", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api")>("@/lib/api")),
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, username: "alice" }, loading: false, error: null, retry: vi.fn() }),
}));
vi.mock("@/sockets/roomHandlers", () => ({
  registerRoomHandlers: () => vi.fn(),
  leaveRoom: vi.fn(),
}));
vi.mock("@/sockets/socketClient", () => ({
  subscribe: () => vi.fn(),
  getConnectionStatus: () => "connected",
  onConnectionStatusChange: () => vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

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
    trick: { number: 1, cards: [{ userId: 4, suit: "coppe", value: "tre", signal: null }] },
    lastTrick: null,
    myHand: [{ suit: "denara", value: "asso" }],
    playableCards: [{ suit: "denara", value: "asso" }],
    turn: { userId: 1, phase: "play_card", startedAt: new Date().toISOString(), deadline: null },
    score: { team0: { points: 0, figures: 0 }, team1: { points: 0, figures: 0 } },
    roundSummary: null,
    result: null,
    lastAction: null,
    ...overrides,
  };
}

const finishedPractice = () => gameState({
  isPractice: true,
  status: "finished",
  result: {
    winnerTeam: 0,
    totalRounds: 1,
    finalScores: { team0: 41, team1: 0 },
    roundsWon: { team0: 1, team1: 0 },
    statistics: { players: [], rounds: [] },
  },
});

function renderTable() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/game/ROOM"]}>
        <Routes>
          <Route path="/game/:gameRoomCode" element={<GameTable />} />
          <Route path="/room/:roomCode" element={<p>stanza</p>} />
          <Route path="/" element={<p>lobby</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("GameTable page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it.each([
    [400, "stanza"],
    [403, "lobby"],
    [404, "lobby"],
  ])("leaves the table on a %i load error", async (status, page) => {
    mocks.apiGet.mockRejectedValue(new ApiError(status, "error"));
    renderTable();
    expect(await screen.findByText(page)).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it("reports a rejected card and refetches the table", async () => {
    mocks.apiGet.mockResolvedValue(gameState());
    mocks.apiPost.mockRejectedValue(new ApiError(400, "Invalid", { error: "Devi rispondere a coppe" }));
    renderTable();

    fireEvent.click(await screen.findByTestId("hand-card-denara-asso"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Devi rispondere a coppe"));
    expect(mocks.apiGet).toHaveBeenCalledTimes(2);
  });

  it("lets a bot-controlled player resume control", async () => {
    mocks.apiGet.mockResolvedValue(gameState({
      players: gameState().players.map((player) => player.userId === 1 ? { ...player, botModel: "forte" } : player),
    }));
    mocks.apiPost.mockResolvedValue({});
    renderTable();

    fireEvent.click(await screen.findByRole("button", { name: "Riprendi controllo" }));

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/rooms/ROOM/resume-control", {}));
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledTimes(2));
  });

  it("treats an already removed practice room as cleaned up", async () => {
    mocks.apiGet.mockResolvedValue(finishedPractice());
    mocks.apiPost.mockRejectedValue(new ApiError(404, "Room not found"));
    renderTable();

    fireEvent.click(await screen.findByRole("button", { name: "Torna alla lobby" }));

    expect(await screen.findByText("lobby")).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("keeps the result when cleanup fails and lets Home retry", async () => {
    mocks.apiGet.mockResolvedValue(finishedPractice());
    mocks.apiPost.mockRejectedValueOnce(new Error("cleanup failed")).mockResolvedValueOnce({});
    renderTable();

    fireEvent.click(await screen.findByRole("button", { name: "Torna alla lobby" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Impossibile abbandonare la partita. Riprova."));

    fireEvent.click(screen.getByRole("button", { name: "Torna alla lobby" }));
    expect(await screen.findByText("lobby")).toBeInTheDocument();
    expect(mocks.apiPost).toHaveBeenCalledTimes(2);
  });
});
