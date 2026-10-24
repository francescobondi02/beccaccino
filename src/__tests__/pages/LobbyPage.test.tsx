import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import LobbyPage from "@/pages/LobbyPage";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn<(path: string) => Promise<unknown>>(),
  apiPost: vi.fn(),
  auth: {
    user: { id: 1, username: "alice" } as {
      id: number;
      username: string;
    } | null,
    loading: false,
    error: null as Error | null,
    retry: vi.fn(),
  },
  navigate: vi.fn(),
  unregisterLobby: vi.fn(),
  leaveLobby: vi.fn(),
  reconnectLobby: null as (() => void) | null,
  lobbySubscriptions: new Map<string, (...args: unknown[]) => void>(),
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiGet: mocks.apiGet,
    apiPost: mocks.apiPost,
  };
});
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mocks.auth,
}));
vi.mock("@/hooks/useConnectionStatus", () => ({
  useConnectionStatus: () => "connected",
}));
vi.mock("@/components/Header", () => ({
  default: () => <div data-testid="header" />,
}));
vi.mock("@/components/AuthDialog", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="auth-dialog" /> : null,
}));
vi.mock("@/sockets/lobbyHandlers", () => ({
  registerLobbyHandlers: (_userId: number, onReconnect: () => void) => {
    mocks.reconnectLobby = onReconnect;
    return mocks.unregisterLobby;
  },
  leaveLobby: mocks.leaveLobby,
  subscribeToLobbyEvent: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => {
    mocks.lobbySubscriptions.set(event, listener);
    return vi.fn();
  },
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});
vi.mock("sonner", () => ({
  toast: mocks.toast,
}));

function renderLobby() {
  return render(
    <MemoryRouter>
      <LobbyPage />
    </MemoryRouter>,
  );
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

describe("LobbyPage room commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
    mocks.reconnectLobby = null;
    mocks.lobbySubscriptions.clear();
    mocks.auth.user = { id: 1, username: "alice" };
    mocks.auth.loading = false;
    mocks.auth.error = null;
    mocks.apiGet.mockResolvedValue({
      availableRooms: [{ id: 10, code: "LIST01", players: [] }],
      activeGames: [],
    });
  });

  it("uses the approved design for real room actions, without demo rooms", async () => {
    mocks.apiPost.mockResolvedValue({ code: "NEW123" });
    renderLobby();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("NON È SOLO FORTUNA.");
    expect(screen.getByRole("heading", { name: "TROVA IL TUO SOCIO." })).toBeInTheDocument();
    expect(screen.queryByText(/dati demo|tavoli dimostrativi/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("hero-primary-action"));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/rooms/", {}));
    expect(mocks.navigate).toHaveBeenCalledWith("/room/NEW123");
  });

  it("submits invitation codes through the native form", async () => {
    mocks.apiPost.mockResolvedValue({});
    renderLobby();
    const input = screen.getByRole("textbox", { name: "Codice stanza" });
    fireEvent.change(input, { target: { value: "abc123" } });
    expect(input).toHaveValue("ABC123");
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/rooms/join", { roomCode: "ABC123" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/room/ABC123");
  });

  it("joins listed and typed rooms through the same API contract", async () => {
    mocks.apiPost.mockResolvedValue({});
    renderLobby();

    fireEvent.change(screen.getByTestId("room-code-input"), {
      target: { value: " ab12 " },
    });
    fireEvent.click(screen.getByTestId("join-by-code-button"));

    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith("/rooms/join", {
        roomCode: "AB12",
      }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith("/room/AB12");

    fireEvent.click(await screen.findByRole("button", { name: "Entra" }));

    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith("/rooms/join", {
        roomCode: "LIST01",
      }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith("/room/LIST01");
  });

  it("redirects active-room conflicts instead of showing a generic error", async () => {
    mocks.apiPost.mockRejectedValue(
      new ApiError(409, "Already playing", { activeRoomCode: "LIVE01" }),
    );
    renderLobby();

    fireEvent.click(screen.getByTestId("create-room-button"));

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith("/game/LIVE01"),
    );
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "Sei già in una partita attiva",
    );
  });

  it("keeps ordinary join failures separate from conflict redirects", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.apiPost.mockRejectedValue(new Error("Join unavailable"));
    renderLobby();

    fireEvent.change(screen.getByTestId("room-code-input"), {
      target: { value: "ROOM01" },
    });
    fireEvent.click(screen.getByTestId("join-by-code-button"));

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Join unavailable"),
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("validates an empty typed code before sending a request", async () => {
    renderLobby();
    await screen.findByRole("button", { name: "Entra" });

    fireEvent.click(screen.getByTestId("join-by-code-button"));

    expect(mocks.toast.error).toHaveBeenCalledWith(
      "Inserisci un codice stanza",
    );
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it("separates paused practice games and resumes before navigating", async () => {
    mocks.apiGet.mockResolvedValue({
      availableRooms: [{ id: 10, code: "LIST01", players: [] }],
      activeGames: [
        {
          id: 20,
          code: "PAUSE1",
          players: [],
          isPractice: true,
          pausedAt: "2026-08-27T18:00:00.000Z",
        },
        {
          id: 21,
          code: "ACTIVE",
          players: [],
          isPractice: true,
          pausedAt: null,
        },
      ],
    });
    let resolveResume: (() => void) | undefined;
    mocks.apiPost.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveResume = () => resolve({ success: true, paused: false });
        }),
    );

    renderLobby();

    const pausedSection = (
      await screen.findByRole("heading", {
        name: "Allenamenti in pausa",
      })
    ).parentElement;
    const activeSection = screen.getByRole("heading", {
      name: "Partite in corso",
    }).parentElement;

    expect(pausedSection).not.toBeNull();
    expect(activeSection).not.toBeNull();
    expect(within(pausedSection!).getByText("PAUSE1")).toBeInTheDocument();
    expect(within(activeSection!).queryByText("PAUSE1")).not.toBeInTheDocument();
    expect(within(activeSection!).getByText("ACTIVE")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Stanze disponibili" }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(pausedSection!).getByRole("button", { name: "Riprendi" }),
    );

    expect(mocks.apiPost).toHaveBeenCalledWith("/rooms/PAUSE1/resume", {});
    expect(mocks.navigate).not.toHaveBeenCalled();

    await act(async () => {
      resolveResume?.();
    });

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith("/game/PAUSE1"),
    );
  });

  it("reconciles paused practice games from other tabs", async () => {
    mocks.apiGet.mockResolvedValue({
      availableRooms: [],
      activeGames: [
        {
          id: 20,
          code: "PRACT1",
          players: [],
          isPractice: true,
          pausedAt: null,
        },
      ],
    });
    renderLobby();
    await screen.findByText("PRACT1");

    mocks.apiGet.mockResolvedValue({
      availableRooms: [],
      activeGames: [
        {
          id: 20,
          code: "PRACT1",
          players: [],
          isPractice: true,
          pausedAt: "2026-08-27T18:00:00.000Z",
        },
      ],
    });
    await act(async () => {
      mocks.lobbySubscriptions.get("practice_paused")?.({
        roomCode: "PRACT1",
        pausedAt: "2026-08-27T18:00:00.000Z",
      });
    });
    expect(
      screen.getByRole("heading", { name: "Allenamenti in pausa" }),
    ).toBeInTheDocument();

    mocks.apiGet.mockResolvedValue({
      availableRooms: [],
      activeGames: [
        {
          id: 20,
          code: "PRACT1",
          players: [],
          isPractice: true,
          pausedAt: null,
        },
      ],
    });
    await act(async () => {
      mocks.lobbySubscriptions.get("practice_resumed")?.({
        roomCode: "PRACT1",
      });
    });
    expect(
      screen.queryByRole("heading", { name: "Allenamenti in pausa" }),
    ).not.toBeInTheDocument();

    mocks.apiGet.mockResolvedValue({
      availableRooms: [],
      activeGames: [],
    });
    await act(async () => {
      mocks.lobbySubscriptions.get("practice_abandoned")?.({
        roomCode: "PRACT1",
      });
    });
    expect(screen.queryByText("PRACT1")).not.toBeInTheDocument();

    mocks.apiGet.mockResolvedValue({
      availableRooms: [],
      activeGames: [
        {
          id: 21,
          code: "MISSED",
          players: [],
          isPractice: true,
          pausedAt: "2026-08-27T19:00:00.000Z",
        },
      ],
    });
    await act(async () => mocks.reconnectLobby?.());

    expect(await screen.findByText("MISSED")).toBeInTheDocument();
  });

  it("loads a paused practice game first seen through a lifecycle event", async () => {
    renderLobby();
    await screen.findByText("LIST01");

    mocks.apiGet.mockResolvedValue({
      availableRooms: [],
      activeGames: [
        {
          id: 22,
          code: "NEWTAB",
          players: [],
          isPractice: true,
          pausedAt: "2026-08-27T20:00:00.000Z",
        },
      ],
    });

    act(() => {
      mocks.lobbySubscriptions.get("practice_paused")?.({
        roomCode: "NEWTAB",
        pausedAt: "2026-08-27T20:00:00.000Z",
      });
    });

    expect(await screen.findByText("NEWTAB")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Allenamenti in pausa" }),
    ).toBeInTheDocument();
  });

  it("keeps rooms visible while lifecycle reconciliation is pending", async () => {
    mocks.apiGet.mockResolvedValue({
      availableRooms: [],
      activeGames: [
        {
          id: 25,
          code: "VISIBLE",
          players: [],
          isPractice: true,
          pausedAt: null,
        },
      ],
    });
    renderLobby();
    await screen.findByText("VISIBLE");

    const lifecycleFetch = deferred<unknown>();
    mocks.apiGet.mockReturnValueOnce(lifecycleFetch.promise);
    act(() => {
      mocks.lobbySubscriptions.get("practice_paused")?.({
        roomCode: "VISIBLE",
        pausedAt: "2026-08-27T22:00:00.000Z",
      });
    });

    expect(screen.getByText("VISIBLE")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Allenamenti in pausa" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Caricamento stanze...")).not.toBeInTheDocument();

    await act(async () => {
      lifecycleFetch.resolve({
        availableRooms: [],
        activeGames: [
          {
            id: 25,
            code: "VISIBLE",
            players: [],
            isPractice: true,
            pausedAt: "2026-08-27T22:00:00.000Z",
          },
        ],
      });
    });
  });

  it("keeps rooms visible while reconnect reconciliation is pending", async () => {
    mocks.apiGet.mockResolvedValue({
      availableRooms: [],
      activeGames: [
        {
          id: 26,
          code: "RECON1",
          players: [],
          isPractice: true,
          pausedAt: "2026-08-27T23:00:00.000Z",
        },
      ],
    });
    renderLobby();
    await screen.findByText("RECON1");

    const reconnectFetch = deferred<unknown>();
    mocks.apiGet.mockReturnValueOnce(reconnectFetch.promise);
    act(() => mocks.reconnectLobby?.());

    expect(screen.getByText("RECON1")).toBeInTheDocument();
    expect(screen.queryByText("Caricamento stanze...")).not.toBeInTheDocument();

    await act(async () => {
      reconnectFetch.resolve({
        availableRooms: [],
        activeGames: [
          {
            id: 26,
            code: "RECON1",
            players: [],
            isPractice: true,
            pausedAt: "2026-08-27T23:00:00.000Z",
          },
        ],
      });
    });
  });

  it("ignores a room fetch failure after unmount", async () => {
    const roomFetch = deferred<unknown>();
    mocks.apiGet.mockReturnValueOnce(roomFetch.promise);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { unmount } = renderLobby();
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledTimes(1));
    unmount();

    await act(async () => {
      roomFetch.reject(new Error("late room failure"));
    });

    expect(consoleError).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("ignores an older room response that finishes after a newer refresh", async () => {
    const initialFetch = deferred<unknown>();
    const reconnectFetch = deferred<unknown>();
    mocks.apiGet
      .mockReturnValueOnce(initialFetch.promise)
      .mockReturnValueOnce(reconnectFetch.promise);

    renderLobby();
    await waitFor(() => expect(mocks.reconnectLobby).not.toBeNull());

    act(() => mocks.reconnectLobby?.());

    await act(async () => {
      reconnectFetch.resolve({
        availableRooms: [],
        activeGames: [
          {
            id: 23,
            code: "CURRENT",
            players: [],
            isPractice: true,
            pausedAt: "2026-08-27T21:00:00.000Z",
          },
        ],
      });
    });
    expect(await screen.findByText("CURRENT")).toBeInTheDocument();

    await act(async () => {
      initialFetch.resolve({
        availableRooms: [],
        activeGames: [
          {
            id: 24,
            code: "STALE",
            players: [],
            isPractice: true,
            pausedAt: null,
          },
        ],
      });
    });

    expect(screen.getByText("CURRENT")).toBeInTheDocument();
    expect(screen.queryByText("STALE")).not.toBeInTheDocument();
  });
});
