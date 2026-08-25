import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GameTable from "@/pages/GameTable";
import type { GameFinishedPayload } from "@/sockets/events";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn<(path: string) => Promise<unknown>>(),
  apiPost: vi.fn(),
  navigate: vi.fn(),
  toastError: vi.fn(),
  playerLeft: null as ((payload: { userId: number }) => void) | null,
  gameHook: {
    currentRound: {
      id: 30,
      number: 1,
      briscola: "spade",
    } as { id: number; number: number; briscola: string | null },
    callerUserId: 1,
    myCards: [
      {
        id: 40,
        suit: "coppe",
        value: "asso",
        playerId: 10,
        roundId: 30,
        inHand: true,
      },
    ],
    currentTurnUserId: 1,
    playedCards: [] as Array<{
      playerId: number;
      userId: number;
      suit: string;
      value: string;
      position: number;
    }>,
    playableCards: [
      {
        id: 40,
        suit: "coppe",
        value: "asso",
        playerId: 10,
        roundId: 30,
        inHand: true,
      },
    ],
    lastHand: [],
    currentHandNumber: 1,
    totalPoints: {
      team0Points: 6,
      team1Points: 3,
      team0Figures: 0,
      team1Figures: 1,
    },
    turnTimer: null,
    currentSignal: null,
    isPractice: false,
    allHands: null,
    moveLog: [],
    roundEndData: null,
    gameFinishedData: null as GameFinishedPayload | null,
    gameStateStatus: "ready" as "loading" | "ready" | "error",
    refetchGameState: vi.fn<() => Promise<void>>(),
    dismissRoundEnd: vi.fn(),
    applyLocalBriscola: vi.fn(),
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
  useAuth: () => ({
    user: { id: 1, username: "alice" },
    loading: false,
    error: null,
    retry: vi.fn(),
  }),
}));
vi.mock("@/hooks/useGameTable", () => ({
  useGameTable: () => mocks.gameHook,
}));
vi.mock("@/hooks/useConnectionStatus", () => ({
  useConnectionStatus: () => "connected",
}));
vi.mock("@/sockets/roomHandlers", () => ({
  subscribeToRoomEvent: (
    event: string,
    callback: (payload: { userId: number }) => void,
  ) => {
    if (event === "player_left") {
      mocks.playerLeft = callback;
    }
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
  toast: {
    error: mocks.toastError,
    success: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock("@/components/PlayingCard", () => ({
  default: ({
    onClick,
    clickable,
    "data-testid": testId,
  }: {
    onClick: () => void;
    clickable: boolean;
    "data-testid"?: string;
  }) => (
    <button type="button" data-testid={testId} onClick={onClick} disabled={!clickable}>
      Carta
    </button>
  ),
}));
vi.mock("@/components/SignalDialog", () => ({
  default: ({
    open,
    onSelect,
  }: {
    open: boolean;
    onSelect: (signal: null) => void;
  }) =>
    open ? (
      <button type="button" onClick={() => onSelect(null)}>
        Nessun segnale
      </button>
    ) : null,
}));
vi.mock("@/components/PlayerSeat", () => ({
  default: ({
    player,
    testId,
  }: {
    player: { username: string };
    testId?: string;
  }) => <div data-testid={testId}>{player.username}</div>,
}));
vi.mock("@/components/ConnectionBanner", () => ({
  default: () => null,
}));
vi.mock("@/components/GameChat", () => ({
  default: () => null,
}));
vi.mock("@/components/TrumpSuitDialog", () => ({
  default: () => null,
}));
vi.mock("@/components/LastTrickDialog", () => ({
  default: () => null,
}));
vi.mock("@/components/RoundEndDialog", () => ({
  default: () => null,
}));
vi.mock("@/components/GameFinishedDialog", () => ({
  default: ({
    open,
    onHome,
    isReturningHome,
  }: {
    open: boolean;
    onHome: () => Promise<void>;
    isReturningHome: boolean;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() => void onHome()}
        disabled={isReturningHome}
      >
        Torna alla Home
      </button>
    ) : null,
}));
vi.mock("@/components/PracticePanel", () => ({
  default: () => null,
}));

const room = {
  id: 20,
  code: "ROOM",
  started: true,
  finished: false,
  isPractice: false,
  players: [
    {
      id: 10,
      userId: 1,
      username: "alice",
      seat: 0,
      team: 0,
      isReady: true,
    },
    {
      id: 11,
      userId: 2,
      username: "bob",
      seat: 1,
      team: 1,
      isReady: true,
    },
    {
      id: 12,
      userId: 3,
      username: "carla",
      seat: 2,
      team: 0,
      isReady: true,
    },
    {
      id: 13,
      userId: 4,
      username: "diego",
      seat: 3,
      team: 1,
      isReady: true,
    },
  ],
};

const finishedGame: GameFinishedPayload = {
  winnerTeam: 0,
  totalRounds: 3,
  finalScores: {
    team0: 181,
    team1: 179,
  },
  roundsWon: {
    team0: 2,
    team1: 1,
  },
};

function gameTableRoute() {
  return (
    <MemoryRouter initialEntries={["/game/ROOM"]}>
      <Routes>
        <Route path="/game/:gameRoomCode" element={<GameTable />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderGameTable() {
  return render(gameTableRoute());
}

function usePracticeRoom() {
  mocks.gameHook.isPractice = true;
  mocks.apiGet.mockResolvedValue({ ...room, isPractice: true });
}

describe("GameTable page behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
    mocks.playerLeft = null;
    mocks.gameHook.currentRound = {
      id: 30,
      number: 1,
      briscola: "spade",
    };
    mocks.gameHook.callerUserId = 1;
    mocks.gameHook.currentTurnUserId = 1;
    mocks.gameHook.playedCards = [];
    mocks.gameHook.isPractice = false;
    mocks.gameHook.gameFinishedData = null;
    mocks.gameHook.gameStateStatus = "ready";
    mocks.gameHook.refetchGameState.mockResolvedValue(undefined);
    mocks.apiGet.mockResolvedValue(room);
    mocks.apiPost.mockResolvedValue({});
  });

  it("names the caller while a new round is waiting for briscola", async () => {
    mocks.gameHook.currentRound = {
      id: 31,
      number: 2,
      briscola: null,
    };
    mocks.gameHook.callerUserId = 2;
    mocks.gameHook.currentTurnUserId = 2;

    renderGameTable();

    expect(
      await screen.findByText("bob sta selezionando la briscola..."),
    ).toBeInTheDocument();
  });

  it("renders normalized room state and submits a leader card after signal choice", async () => {
    renderGameTable();

    expect(await screen.findByTestId("game-table-page")).toBeInTheDocument();
    expect(screen.getByTestId("my-team-points")).toHaveTextContent("6");
    expect(screen.getByTestId("opponent-team-points")).toHaveTextContent("3");

    fireEvent.click(screen.getByTestId("hand-card-coppe-asso"));
    expect(mocks.apiPost).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Nessun segnale" }));

    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith("/games/play-card", {
        roomCode: "ROOM",
        suit: "coppe",
        value: "asso",
        signal: null,
      }),
    );
  });

  it("submits a non-leading card without opening the signal dialog", async () => {
    mocks.gameHook.playedCards = [
      {
        playerId: 11,
        userId: 2,
        suit: "spade",
        value: "due",
        position: 0,
      },
    ];
    renderGameTable();

    fireEvent.click(await screen.findByTestId("hand-card-coppe-asso"));

    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith("/games/play-card", {
        roomCode: "ROOM",
        suit: "coppe",
        value: "asso",
        signal: null,
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Nessun segnale" }),
    ).not.toBeInTheDocument();
  });

  it("renders a retryable game-state failure", async () => {
    mocks.gameHook.gameStateStatus = "error";
    renderGameTable();

    expect(
      await screen.findByText("Impossibile caricare lo stato della partita"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));

    expect(mocks.gameHook.refetchGameState).toHaveBeenCalledOnce();
  });

  it("removes departed opponents from the rendered table", async () => {
    renderGameTable();
    expect(await screen.findByText("bob")).toBeInTheDocument();

    act(() => {
      mocks.playerLeft?.({ userId: 2 });
    });

    expect(screen.queryByText("bob")).not.toBeInTheDocument();
  });

  it("waits for practice cleanup before explicit Home navigation", async () => {
    usePracticeRoom();
    mocks.gameHook.gameFinishedData = finishedGame;
    let resolveCleanup: (() => void) | undefined;
    mocks.apiPost.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCleanup = () => resolve({});
        }),
    );

    renderGameTable();
    fireEvent.click(
      await screen.findByRole("button", { name: "Torna alla Home" }),
    );

    expect(mocks.apiPost).toHaveBeenCalledWith("/rooms/ROOM/leave", {});
    expect(mocks.navigate).not.toHaveBeenCalled();

    await act(async () => {
      resolveCleanup?.();
    });

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/"));
  });

  it("does not delete a practice room on unmount or page refresh", async () => {
    usePracticeRoom();
    const view = renderGameTable();
    await screen.findByTestId("game-table-page");

    view.unmount();

    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it("does not duplicate cleanup after explicit Home succeeds", async () => {
    usePracticeRoom();
    mocks.gameHook.gameFinishedData = finishedGame;
    const view = renderGameTable();

    fireEvent.click(
      await screen.findByRole("button", { name: "Torna alla Home" }),
    );
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/"));

    view.unmount();

    expect(mocks.apiPost).toHaveBeenCalledTimes(1);
    expect(mocks.apiPost).toHaveBeenCalledWith("/rooms/ROOM/leave", {});
  });

  it("never cleans up a multiplayer room", async () => {
    mocks.gameHook.gameFinishedData = finishedGame;
    const view = renderGameTable();

    fireEvent.click(
      await screen.findByRole("button", { name: "Torna alla Home" }),
    );
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/"));

    view.unmount();

    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it("treats an already-swept practice room as cleaned up", async () => {
    usePracticeRoom();
    mocks.gameHook.gameFinishedData = finishedGame;
    mocks.apiPost.mockRejectedValueOnce(
      new (await import("@/lib/api")).ApiError(404, "Room not found"),
    );
    renderGameTable();

    fireEvent.click(
      await screen.findByRole("button", { name: "Torna alla Home" }),
    );

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/"));
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("keeps the finished dialog open when cleanup fails and allows retry", async () => {
    usePracticeRoom();
    mocks.gameHook.gameFinishedData = finishedGame;
    mocks.apiPost
      .mockRejectedValueOnce(new Error("cleanup failed"))
      .mockResolvedValueOnce({});
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    renderGameTable();

    fireEvent.click(
      await screen.findByRole("button", { name: "Torna alla Home" }),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Impossibile chiudere la partita di pratica. Riprova.",
      ),
    );
    expect(mocks.navigate).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Torna alla Home" }),
    );

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/"));
    expect(mocks.apiPost).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });
});
