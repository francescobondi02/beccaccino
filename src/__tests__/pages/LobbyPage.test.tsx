import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  registerLobbyHandlers: () => mocks.unregisterLobby,
  leaveLobby: mocks.leaveLobby,
  subscribeToLobbyEvent: () => vi.fn(),
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

describe("LobbyPage room commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
    mocks.auth.user = { id: 1, username: "alice" };
    mocks.auth.loading = false;
    mocks.auth.error = null;
    mocks.apiGet.mockResolvedValue({
      availableRooms: [{ id: 10, code: "LIST01", players: [] }],
      activeGames: [],
    });
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
});
