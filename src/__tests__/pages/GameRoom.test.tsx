import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import GameRoom from "@/pages/GameRoom";
import { ApiError } from "@/lib/api";
import type { RoomResponse } from "@/rooms/model";
import type {
  PlayerJoinedPayload,
  PlayerLeftPayload,
  ReadyChangedPayload,
  TeamChosenPayload,
} from "@/sockets/events";

const mocks = vi.hoisted(() => {
  type ConnectionStatus = "connected" | "disconnected" | "reconnecting";

  return {
    apiGet: vi.fn<(path: string) => Promise<unknown>>(),
    apiPost: vi.fn(),
    callbacks: {
      playerJoined: null as ((payload: PlayerJoinedPayload) => void) | null,
      playerLeft: null as ((payload: PlayerLeftPayload) => void) | null,
      teamChosen: null as ((payload: TeamChosenPayload) => void) | null,
      readyChanged: null as ((payload: ReadyChangedPayload) => void) | null,
      settingsChanged: null as ((payload: { room: RoomResponse }) => void) | null,
      gameStarted: null as (() => void) | null,
      joined: null as (() => void) | null,
    },
    statusListeners: new Set<(status: ConnectionStatus) => void>(),
    leaveRoom: vi.fn(),
    unregisterRoom: vi.fn(),
    authOptions: undefined as unknown,
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
  useAuth: (options: unknown) => (mocks.authOptions = options, {
    user: { id: 1, username: "alice" },
    loading: false,
    error: null,
    retry: vi.fn(),
  }),
}));
vi.mock("@/components/Header", () => ({
  default: function Header() {
    const navigate = useNavigate();
    return (
      <div data-testid="header">
        <button onClick={() => navigate("/")}>Gioca</button>
      </div>
    );
  },
}));
vi.mock("@/sockets/roomHandlers", () => ({
  registerRoomHandlers: (
    _roomCode: string,
    _user: unknown,
    onJoined?: () => void,
  ) => {
    mocks.callbacks.joined = onJoined ?? null;
    return mocks.unregisterRoom;
  },
  leaveRoom: mocks.leaveRoom,
  subscribeToRoomEvent: (
    event: string,
    callback: (...args: never[]) => void,
  ) => {
    const key = {
      player_joined: "playerJoined",
      player_left: "playerLeft",
      team_chosen: "teamChosen",
      ready_changed: "readyChanged",
      room_settings_changed: "settingsChanged",
      game_started: "gameStarted",
    }[event] as keyof typeof mocks.callbacks;
    mocks.callbacks[key] = callback;
    return () => {
      mocks.callbacks[key] = null;
    };
  },
}));
vi.mock("@/sockets/socketClient", () => ({
  getConnectionStatus: () => "connected",
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
    <BrowserRouter>
      <Routes>
        <Route path="/room/:roomCode" element={<GameRoom />} />
        <Route path="/" element={<p>Lobby</p>} />
        <Route path="/game/:roomCode" element={<p>Tavolo</p>} />
      </Routes>
    </BrowserRouter>,
  );
}

describe("GameRoom state synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
    mocks.apiPost.mockResolvedValue({ success: true });
    window.history.replaceState({}, "", "/room/ROOM");
    mocks.statusListeners.clear();
    Object.keys(mocks.callbacks).forEach((key) => {
      mocks.callbacks[key as keyof typeof mocks.callbacks] = null;
    });
  });

  it("normalizes room players and applies membership, team, and ready events", async () => {
    mocks.apiGet.mockResolvedValue(room([alice, bob]));

    renderGameRoom();

    expect(await screen.findByText("Giocatori: 2 / 4")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByTestId("ready-button")).toBeEnabled();

    act(() => {
      mocks.callbacks.teamChosen?.({ userId: 2, playerId: 11, team: 1 });
      mocks.callbacks.readyChanged?.({
        userId: 2,
        playerId: 11,
        isReady: true,
      });
    });

    expect(screen.getByText("Squadra 2")).toBeInTheDocument();
    expect(screen.getByText("Pronto")).toBeInTheDocument();

    act(() => {
      mocks.callbacks.playerJoined?.({
        player: {
          id: 12,
          userId: 3,
          username: "carla",
          seat: 2,
          team: null,
          isReady: false,
        },
      });
    });
    expect(screen.getByText("carla")).toBeInTheDocument();

    act(() => {
      mocks.callbacks.playerLeft?.({ userId: 2 });
    });
    expect(screen.queryByText("bob")).not.toBeInTheDocument();
    expect(screen.getByText("Giocatori: 2 / 4")).toBeInTheDocument();

    act(() => {
      mocks.callbacks.playerLeft?.({ userId: 1 });
    });
    expect(screen.queryByText("Tu")).not.toBeInTheDocument();
    expect(screen.getByText("Giocatori: 1 / 4")).toBeInTheDocument();
    expect(screen.getByTestId("ready-button")).toBeDisabled();
  });

  it("derives current-player controls from room events", async () => {
    mocks.apiGet.mockResolvedValue(
      room([{ ...alice, team: null, isReady: false }, bob]),
    );

    renderGameRoom();

    expect(await screen.findByTestId("team-0-button")).toBeInTheDocument();
    expect(screen.getByTestId("ready-button")).toBeDisabled();

    act(() => {
      mocks.callbacks.teamChosen?.({ userId: 1, playerId: 10, team: 1 });
    });

    expect(screen.queryByTestId("team-0-button")).not.toBeInTheDocument();
    expect(screen.getByTestId("ready-button")).toBeEnabled();

    act(() => {
      mocks.callbacks.readyChanged?.({
        userId: 1,
        playerId: 10,
        isReady: true,
      });
    });

    expect(screen.getByTestId("ready-button")).toHaveTextContent("Non pronto");
  });

  it("configures virtual bots and lets an arriving friend take a placeholder", async () => {
    mocks.apiGet.mockResolvedValue(room([{ ...alice, isReady: true }]));
    mocks.apiPost.mockResolvedValue({ ...room([alice]), botTier: "forte" });
    renderGameRoom();
    await screen.findByText("Giocatori: 1 / 4");

    fireEvent.change(screen.getByLabelText("Completa i posti liberi con bot"), {
      target: { value: "forte" },
    });

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith(
      "/rooms/ROOM/bots", { tier: "forte" },
    ));
    expect(await screen.findAllByText("Bot alla partenza")).toHaveLength(3);
    expect(screen.getByTestId("ready-button")).toHaveTextContent("Sono pronto!");
    expect(screen.getByText("Giocatori: 1 / 4")).toBeInTheDocument();

    act(() => {
      mocks.callbacks.playerJoined?.({
        player: {
          id: bob.id,
          userId: bob.userId,
          username: "bob",
          seat: null,
          team: null,
          isReady: false,
        },
      });
    });

    expect(screen.getAllByText("Bot alla partenza")).toHaveLength(2);
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByText("Giocatori: 2 / 4")).toBeInTheDocument();
  });

  it("syncs bot settings and reset readiness from another participant", async () => {
    mocks.apiGet.mockResolvedValue(room([{ ...alice, isReady: true }]));
    renderGameRoom();
    await screen.findByText("Giocatori: 1 / 4");

    act(() => {
      mocks.callbacks.settingsChanged?.({
        room: {
          ...room([alice]),
          isPractice: false,
          botTier: "medio",
          players: [alice],
        },
      });
    });

    expect(screen.getByLabelText("Completa i posti liberi con bot")).toHaveValue("medio");
    expect(screen.getAllByText("Bot alla partenza")).toHaveLength(3);
    expect(screen.getByTestId("ready-button")).toHaveTextContent("Sono pronto!");
  });

  it("reports unavailable bots and leaves ready controls usable for retry", async () => {
    mocks.apiGet.mockResolvedValue({ ...room([alice]), botTier: "forte" });
    mocks.apiPost.mockRejectedValue(new ApiError(503, "Bot service unavailable"));
    renderGameRoom();
    await screen.findByText("Giocatori: 1 / 4");

    fireEvent.click(screen.getByTestId("ready-button"));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      "Bot non disponibili. Riprova tra poco.",
    ));
    expect(screen.getByTestId("ready-button")).toBeEnabled();
    expect(screen.getByTestId("ready-button")).toHaveTextContent("Sono pronto!");
  });

  it("hydrates authoritative room state only after the server confirms rejoining", async () => {
    mocks.apiGet.mockImplementation((path) => {
      if (path !== "/rooms/ROOM") {
        return Promise.reject(new Error(`Unexpected request: ${path}`));
      }
      return Promise.resolve(
        mocks.apiGet.mock.calls.length === 1 ? room([alice]) : room([alice, bob]),
      );
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
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);

    act(() => {
      mocks.callbacks.joined?.();
    });

    expect(await screen.findByText("bob")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText("Giocatori: 2 / 4")).toBeInTheDocument(),
    );
    expect(mocks.apiGet).toHaveBeenCalledTimes(2);
  });

  it("leaves the socket room on an ordinary unmount", async () => {
    mocks.apiGet.mockResolvedValue(room([alice]));

    const { unmount } = renderGameRoom();
    await screen.findByText("Giocatori: 1 / 4");
    unmount();

    expect(mocks.unregisterRoom).toHaveBeenCalledOnce();
    expect(mocks.leaveRoom).toHaveBeenCalledWith("ROOM");
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it("removes persistent membership when Gioca leaves the waiting room", async () => {
    mocks.apiGet.mockResolvedValue(room([{ ...alice, isReady: true }, bob]));
    renderGameRoom();
    await screen.findByText("Giocatori: 2 / 4");

    fireEvent.click(screen.getByRole("button", { name: "Gioca" }));

    expect(await screen.findByText("Lobby")).toBeInTheDocument();
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith(
      "/rooms/ROOM/leave",
      {},
    ));
    expect(mocks.apiPost).toHaveBeenCalledOnce();
  });

  it("does not send a second departure after explicitly leaving", async () => {
    mocks.apiGet.mockResolvedValue(room([alice, bob]));
    renderGameRoom();
    await screen.findByText("Giocatori: 2 / 4");

    fireEvent.click(screen.getByTestId("leave-room-button"));

    expect(await screen.findByText("Lobby")).toBeInTheDocument();
    expect(mocks.apiPost).toHaveBeenCalledWith("/rooms/ROOM/leave", {});
    expect(mocks.apiPost).toHaveBeenCalledOnce();
  });

  it("reports an unsuccessful automatic departure", async () => {
    mocks.apiGet.mockResolvedValue(room([alice, bob]));
    mocks.apiPost.mockRejectedValue(new Error("Network unavailable"));
    renderGameRoom();
    await screen.findByText("Giocatori: 2 / 4");

    fireEvent.click(screen.getByRole("button", { name: "Gioca" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      "Errore nel lasciare la stanza",
    ));
  });

  it("returns to the game if it starts before automatic departure completes", async () => {
    mocks.apiGet.mockResolvedValue(room([alice, bob]));
    mocks.apiPost.mockRejectedValue(
      new ApiError(409, "Cannot leave an active multiplayer game"),
    );
    renderGameRoom();
    await screen.findByText("Giocatori: 2 / 4");

    fireEvent.click(screen.getByRole("button", { name: "Gioca" }));

    expect(await screen.findByText("Tavolo")).toBeInTheDocument();
    expect(mocks.apiPost).toHaveBeenCalledOnce();
  });

  it("joins through an invite link before subscribing to the room", async () => {
    let finishJoin!: (value: unknown) => void;
    mocks.apiGet
      .mockRejectedValueOnce(new ApiError(403, "Not a player"))
      .mockResolvedValue(room([alice, bob]));
    mocks.apiPost.mockReturnValueOnce(new Promise((resolve) => { finishJoin = resolve; }));
    renderGameRoom();

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/rooms/join", { roomCode: "ROOM" }));
    expect(mocks.callbacks.joined).toBeNull();
    await act(async () => finishJoin({ success: true }));

    expect(await screen.findByText("Giocatori: 2 / 4")).toBeInTheDocument();
    expect(mocks.callbacks.joined).toEqual(expect.any(Function));
    expect(mocks.authOptions).toEqual({ redirectOnFail: "/?join=ROOM" });
  });

  it("sends an invited player already seated elsewhere to that game", async () => {
    mocks.apiGet.mockRejectedValue(new ApiError(403, "Not a player"));
    mocks.apiPost.mockRejectedValue(
      new ApiError(409, "Already in a room", { activeRoomCode: "LIVE01" }),
    );
    renderGameRoom();

    expect(await screen.findByText("Tavolo")).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("Sei già in una partita attiva");
  });

  it("does not try to leave a room that failed to load", async () => {
    mocks.apiGet.mockRejectedValue(new ApiError(404, "Room not found"));
    renderGameRoom();

    expect(await screen.findByText("Lobby")).toBeInTheDocument();
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it("keeps socket room membership during the game transition", async () => {
    mocks.apiGet.mockResolvedValue(room([alice]));

    const { unmount } = renderGameRoom();
    await screen.findByText("Giocatori: 1 / 4");

    act(() => {
      mocks.callbacks.gameStarted?.();
    });
    window.history.pushState({}, "", "/game/ROOM");
    unmount();

    expect(mocks.unregisterRoom).toHaveBeenCalledOnce();
    expect(mocks.leaveRoom).not.toHaveBeenCalled();
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it("preserves an already-started game loaded without a socket start event", async () => {
    mocks.apiGet.mockResolvedValue({ ...room([alice]), started: true });
    const { unmount } = renderGameRoom();
    await screen.findByText("Tavolo");

    window.history.pushState({}, "", "/game/ROOM");
    unmount();

    expect(mocks.apiPost).not.toHaveBeenCalled();
    expect(mocks.leaveRoom).not.toHaveBeenCalled();
  });
});
