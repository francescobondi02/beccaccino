import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GameRoom from "@/pages/GameRoom";
import type {
  Player,
  ReadyChangedPayload,
  TeamChosenPayload,
} from "@/sockets/events";

const mocks = vi.hoisted(() => {
  type ConnectionStatus = "connected" | "disconnected" | "reconnecting";

  return {
    apiGet: vi.fn<(path: string) => Promise<unknown>>(),
    apiPost: vi.fn(),
    callbacks: {
      playerJoined: null as ((player: Player) => void) | null,
      playerLeft: null as ((userId: number) => void) | null,
      teamChosen: null as ((payload: TeamChosenPayload) => void) | null,
      readyChanged: null as ((payload: ReadyChangedPayload) => void) | null,
      gameStarted: null as (() => void) | null,
    },
    statusListeners: new Set<(status: ConnectionStatus) => void>(),
  };
});

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiGet: mocks.apiGet,
    apiPost: mocks.apiPost,
  };
});
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, username: "alice" } }),
  logout: vi.fn(),
}));
vi.mock("@/components/Header", () => ({
  default: ({ username }: { username?: string }) => (
    <div data-testid="header-user">{username}</div>
  ),
}));
vi.mock("@/sockets/roomHandlers", () => ({
  registerRoomHandlers: vi.fn(),
  leaveRoom: vi.fn(),
  onPlayerJoined: (callback: typeof mocks.callbacks.playerJoined) => {
    mocks.callbacks.playerJoined = callback;
  },
  offPlayerJoined: vi.fn(),
  onPlayerLeft: (callback: typeof mocks.callbacks.playerLeft) => {
    mocks.callbacks.playerLeft = callback;
  },
  offPlayerLeft: vi.fn(),
  onTeamChosen: (callback: typeof mocks.callbacks.teamChosen) => {
    mocks.callbacks.teamChosen = callback;
  },
  offTeamChosen: vi.fn(),
  onReadyChanged: (callback: typeof mocks.callbacks.readyChanged) => {
    mocks.callbacks.readyChanged = callback;
  },
  offReadyChanged: vi.fn(),
  onGameStarted: (callback: typeof mocks.callbacks.gameStarted) => {
    mocks.callbacks.gameStarted = callback;
  },
  offGameStarted: vi.fn(),
}));
vi.mock("@/sockets/socketClient", () => ({
  getConnectionStatus: () => "connected",
  registerErrorToast: () => vi.fn(),
  onConnectionStatusChange: (
    listener: (
      status: "connected" | "disconnected" | "reconnecting"
    ) => void,
  ) => {
    mocks.statusListeners.add(listener);
    return () => mocks.statusListeners.delete(listener);
  },
}));
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const alice = {
  id: 10,
  userId: 1,
  seat: 0,
  team: 0,
  isReady: false,
  user: { username: "alice" },
};

const bob = {
  id: 11,
  userId: 2,
  seat: 1,
  team: null,
  isReady: false,
  user: { username: "bob" },
};

function room(players: unknown[]) {
  return {
    id: 20,
    code: "ROOM",
    started: false,
    finished: false,
    players,
  };
}

function renderGameRoom() {
  return render(
    <MemoryRouter initialEntries={["/room/ROOM"]}>
      <Routes>
        <Route path="/room/:roomCode" element={<GameRoom />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("GameRoom state synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
    mocks.statusListeners.clear();
    Object.keys(mocks.callbacks).forEach((key) => {
      mocks.callbacks[key as keyof typeof mocks.callbacks] = null;
    });
  });

  it("normalizes room players and applies membership, team, and ready events", async () => {
    mocks.apiGet.mockResolvedValue(room([alice, bob]));

    renderGameRoom();

    expect(await screen.findByText("Giocatori: 2 / 4")).toBeInTheDocument();
    expect(screen.getAllByText("alice")).toHaveLength(2);
    expect(screen.getByText("bob")).toBeInTheDocument();

    act(() => {
      mocks.callbacks.teamChosen?.({ userId: 2, team: 1 });
      mocks.callbacks.readyChanged?.({ userId: 2, isReady: true });
    });

    expect(screen.getByText("Team 2")).toBeInTheDocument();
    expect(screen.getByText("Pronto")).toBeInTheDocument();

    act(() => {
      mocks.callbacks.playerJoined?.({
        id: 12,
        userId: 3,
        username: "carla",
        seat: 2,
        team: null,
        isReady: false,
      });
    });
    expect(screen.getByText("carla")).toBeInTheDocument();

    act(() => {
      mocks.callbacks.playerLeft?.(2);
    });
    expect(screen.queryByText("bob")).not.toBeInTheDocument();
    expect(screen.getByText("Giocatori: 2 / 4")).toBeInTheDocument();

    act(() => {
      mocks.callbacks.playerLeft?.(1);
    });
    expect(screen.queryByText("Tu")).not.toBeInTheDocument();
    expect(screen.getByText("Giocatori: 1 / 4")).toBeInTheDocument();
  });

  it("hydrates authoritative room state after reconnecting", async () => {
    mocks.apiGet.mockImplementation((path) => {
      if (path === "/rooms/ROOM?userId=1") {
        return Promise.resolve(room([alice]));
      }
      if (path === "/rooms/ROOM") {
        return Promise.resolve(room([alice, bob]));
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    renderGameRoom();
    expect(await screen.findByText("Giocatori: 1 / 4")).toBeInTheDocument();

    act(() => {
      mocks.statusListeners.forEach((listener) => listener("connected"));
    });
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);

    act(() => {
      mocks.statusListeners.forEach((listener) => listener("disconnected"));
    });
    expect(screen.getByText("Connessione persa. Riconnessione automatica...")).toBeInTheDocument();

    act(() => {
      mocks.statusListeners.forEach((listener) => listener("connected"));
    });

    expect(await screen.findByText("bob")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("Giocatori: 2 / 4")).toBeInTheDocument(),
    );
    expect(mocks.apiGet).toHaveBeenCalledTimes(2);
  });
});
