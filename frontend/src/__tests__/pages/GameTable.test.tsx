import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GameTable from "@/pages/GameTable";
import type TrumpSuitDialog from "@/components/TrumpSuitDialog";
import { ApiError } from "@/lib/api";
import type { CompletedTrick, PlayedCardData, PlayerControl, RoundEndData, RoundDeal } from "@/game/model";
import type { GameFinishedPayload } from "@/sockets/events";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn<(path: string) => Promise<unknown>>(),
  apiPost: vi.fn(),
  navigate: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  playerLeft: null as ((payload: { userId: number }) => void) | null,
  practiceAbandoned: null as
    | ((payload: { roomCode: string }) => void)
    | null,
  gameHook: {
    currentRound: {
      id: 30,
      number: 1,
      briscola: "spade",
    } as { id: number; number: number; briscola: string | null },
    callerUserId: 1,
    roundDeal: null as RoundDeal | null,
    completedTrick: undefined as CompletedTrick | undefined,
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
    animatedCard: null as PlayedCardData | null,
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
    lastHand: [] as PlayedCardData[],
    currentHandNumber: 1,
    totalPoints: {
      team0Points: 6,
      team1Points: 3,
      team0Figures: 0,
      team1Figures: 1,
    },
    turnTimer: null,
    currentSignal: null,
    notice: null as string | null,
    playerControls: [] as PlayerControl[],
    isPractice: false,
    roundEndData: null as RoundEndData | null,
    gameFinishedData: null as GameFinishedPayload | null,
    gameStatus: "playing" as
      | "choosing_briscola"
      | "playing"
      | "paused"
      | "finished",
    gameStateStatus: "ready" as "loading" | "ready" | "error",
    refetchGameState: vi.fn<() => Promise<void>>(),
    setRequestsEnabled: vi.fn(),
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
    callback: (...args: unknown[]) => void,
  ) => {
    if (event === "player_left") {
      mocks.playerLeft = callback as (payload: { userId: number }) => void;
    }
    if (event === "practice_abandoned") {
      mocks.practiceAbandoned = callback as (payload: {
        roomCode: string;
      }) => void;
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
    info: mocks.toastInfo,
    success: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock("@/components/PlayingCard", () => ({
  default: ({
    onClick,
    clickable,
    "data-testid": testId,
    "aria-pressed": pressed,
  }: {
    onClick: () => void;
    clickable: boolean;
    "data-testid"?: string;
    "aria-pressed"?: boolean;
  }) => (
    <button type="button" data-testid={testId} aria-pressed={pressed} onClick={onClick} disabled={!clickable}>
      Carta
    </button>
  ),
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
  default: (props: ComponentProps<typeof TrumpSuitDialog>) =>
    props.open ? <div data-testid="trump-suit-dialog">{props.actions}</div> : null,
}));
vi.mock("@/components/RoundEndDialog", () => ({
  default: () => null,
}));
vi.mock("@/components/GameResult", () => ({
  default: ({
    onHome,
    isReturningHome,
  }: {
    onHome: () => Promise<void>;
    isReturningHome: boolean;
  }) =>
    (
      <button
        type="button"
        onClick={() => void onHome()}
        disabled={isReturningHome}
      >
        Torna alla Home
      </button>
    ),
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
    mocks.practiceAbandoned = null;
    mocks.gameHook.animatedCard = null;
    mocks.gameHook.currentRound = {
      id: 30,
      number: 1,
      briscola: "spade",
    };
    mocks.gameHook.callerUserId = 1;
    mocks.gameHook.roundDeal = null;
    mocks.gameHook.completedTrick = undefined;
    mocks.gameHook.currentTurnUserId = 1;
    mocks.gameHook.playedCards = [];
    mocks.gameHook.lastHand = [];
    mocks.gameHook.isPractice = false;
    mocks.gameHook.notice = null;
    mocks.gameHook.playerControls = [];
    mocks.gameHook.roundEndData = null;
    mocks.gameHook.gameFinishedData = null;
    mocks.gameHook.gameStatus = "playing";
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
      await screen.findByText("bob sceglie la briscola"),
    ).toBeInTheDocument();
  });

  it("renders normalized room state and submits a leader card after signal choice", async () => {
    renderGameTable();

    expect(await screen.findByTestId("game-table-page")).toBeInTheDocument();
    expect(screen.getByTestId("player-position-top")).toContainElement(
      screen.getByTestId("player-seat-top"),
    );
    expect(screen.getByTestId("my-team-points")).toHaveTextContent("6");
    expect(screen.getByTestId("opponent-team-points")).toHaveTextContent("3");

    fireEvent.click(screen.getByTestId("hand-card-coppe-asso"));
    expect(mocks.apiPost).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Niente" }));

    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith("/games/play-card", {
        roomCode: "ROOM",
        suit: "coppe",
        value: "asso",
        signal: null,
      }),
    );
  });

  it("discards a pending card when the server advances the turn", async () => {
    const view = renderGameTable();

    fireEvent.click(await screen.findByTestId("hand-card-coppe-asso"));
    expect(
      screen.getByRole("dialog", { name: "Vuoi dichiarare qualcosa?" }),
    ).toBeInTheDocument();

    mocks.gameHook.currentTurnUserId = 2;
    view.rerender(gameTableRoute());

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Vuoi dichiarare qualcosa?" }),
      ).toBeNull(),
    );
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it("keeps card flight and trick collection animations on the board", async () => {
    const original = Element.prototype.animate;
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel, onfinish: null }));
    Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animate });
    try {
      const view = renderGameTable();
      await screen.findByTestId("game-layout");
      const cards = room.players.map((player, position) => ({
        playerId: player.id, userId: player.userId, suit: "spade",
        value: ["tre", "due", "asso", "quattro"][position], position,
      }));
      mocks.gameHook.playedCards = [cards[0]];
      mocks.gameHook.animatedCard = cards[0];
      view.rerender(gameTableRoute());
      expect(animate).toHaveBeenCalledTimes(1);
      mocks.gameHook.playedCards = cards;
      mocks.gameHook.completedTrick = { cards, winnerUserId: 1, roundId: 30 };
      view.rerender(gameTableRoute());
      expect(animate).toHaveBeenCalledTimes(5);
      view.unmount();
      expect(cancel).toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(Element.prototype, "animate", { configurable: true, value: original });
      else Reflect.deleteProperty(Element.prototype, "animate");
    }
  });

  it("shows only the previous trick's four cards instead of full practice history", async () => {
    usePracticeRoom();
    mocks.gameHook.lastHand = room.players.map((player, position) => ({
      playerId: player.id,
      userId: player.userId,
      suit: "coppe",
      value: ["asso", "due", "tre", "quattro"][position],
      position,
    }));
    renderGameTable();

    await screen.findByTestId("game-table-page");
    expect(
      screen.queryByTestId("open-practice-history"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ultima presa" }));
    const lastTrick = within(screen.getByRole("dialog", { name: "Ultima presa" }));
    expect(lastTrick.getAllByText("Carta")).toHaveLength(4);
    expect(lastTrick.getByText("Tu")).toBeInTheDocument();
    expect(
      screen.queryByTestId("toggle-reveal-hands"),
    ).not.toBeInTheDocument();
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
      screen.queryByRole("button", { name: "Niente" }),
    ).not.toBeInTheDocument();
  });

  it("reports a rejected card and reloads the authoritative table", async () => {
    mocks.gameHook.playedCards = [
      { playerId: 11, userId: 2, suit: "spade", value: "due", position: 0 },
    ];
    mocks.apiPost.mockRejectedValue(
      new ApiError(400, "Invalid card", { error: "Devi rispondere a spade" }),
    );
    renderGameTable();

    fireEvent.click(await screen.findByTestId("hand-card-coppe-asso"));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Devi rispondere a spade"));
    expect(mocks.gameHook.refetchGameState).toHaveBeenCalledOnce();
    expect(screen.getByTestId("hand-card-coppe-asso")).toBeEnabled();
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
    expect(mocks.gameHook.setRequestsEnabled).toHaveBeenCalledWith(false);
    expect(mocks.gameHook.setRequestsEnabled.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.apiPost.mock.invocationCallOrder[0]);
    expect(mocks.navigate).not.toHaveBeenCalled();

    await act(async () => {
      resolveCleanup?.();
    });

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/"));
  });

  it("waits for a manual pause before returning home", async () => {
    usePracticeRoom();
    let resolvePause: (() => void) | undefined;
    mocks.apiPost.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePause = () => resolve({ success: true, paused: true });
        }),
    );

    renderGameTable();
    fireEvent.click(await screen.findByTestId("pause-practice-button"));

    expect(mocks.apiPost).toHaveBeenCalledWith("/rooms/ROOM/pause", {});
    expect(mocks.navigate).not.toHaveBeenCalled();

    await act(async () => {
      resolvePause?.();
    });

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/"));
  });

  it("keeps pause and abandon in the toolbar, not in the signal choices", async () => {
    usePracticeRoom();
    renderGameTable();

    fireEvent.click(await screen.findByTestId("hand-card-coppe-asso"));
    const signalDialog = await screen.findByRole("dialog", {
      name: "Vuoi dichiarare qualcosa?",
    });
    expect(within(signalDialog).queryByTestId("pause-practice-button")).toBeNull();
    expect(within(signalDialog).queryByTestId("abandon-practice-button")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abbandona" }));
    const confirmation = within(screen.getByRole("alertdialog"));
    expect(mocks.apiPost).not.toHaveBeenCalled();
    fireEvent.click(confirmation.getByRole("button", { name: "Annulla" }));
    expect(signalDialog).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pausa e torna alla home" }));

    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith("/rooms/ROOM/pause", {}),
    );
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });

  it("blocks a direct paused game until it is resumed", async () => {
    usePracticeRoom();
    mocks.gameHook.gameStatus = "paused";
    renderGameTable();

    const pausedDialog = within(await screen.findByRole("alertdialog"));
    expect(
      pausedDialog.getByRole("button", { name: "Riprendi" }),
    ).toBeInTheDocument();
    expect(
      pausedDialog.getByRole("button", { name: "Abbandona" }),
    ).toBeInTheDocument();

    fireEvent.click(pausedDialog.getByRole("button", { name: "Riprendi" }));

    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith("/rooms/ROOM/resume", {}),
    );
    await waitFor(() =>
      expect(mocks.gameHook.refetchGameState).toHaveBeenCalledOnce(),
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("abandons a paused direct game through destructive cleanup", async () => {
    usePracticeRoom();
    mocks.gameHook.gameStatus = "paused";
    renderGameTable();

    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Abbandona",
      }),
    );
    expect(mocks.apiPost).not.toHaveBeenCalledWith("/rooms/ROOM/leave", {});

    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Abbandona definitivamente",
      }),
    );

    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith("/rooms/ROOM/leave", {}),
    );
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/"));
  });

  it("does not abandon a practice game when confirmation is cancelled", async () => {
    usePracticeRoom();
    renderGameTable();

    fireEvent.click(await screen.findByTestId("abandon-practice-button"));
    expect(mocks.apiPost).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(mocks.apiPost).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("returns home when another tab abandons the practice game", async () => {
    usePracticeRoom();
    renderGameTable();
    await screen.findByTestId("game-table-page");

    act(() => {
      mocks.practiceAbandoned?.({ roomCode: "ROOM" });
    });

    expect(mocks.toastInfo).toHaveBeenCalledWith(
      "L'allenamento è stato abbandonato",
    );
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });

  it("reaches confirmed practice leave from the briscola dialog", async () => {
    usePracticeRoom();
    mocks.gameHook.currentRound = {
      id: 30,
      number: 1,
      briscola: null,
    };
    renderGameTable();

    const trumpDialog = await screen.findByTestId("trump-suit-dialog");
    fireEvent.click(
      within(trumpDialog).getByTestId("abandon-practice-button"),
    );
    // Scoped to the dialog: the trigger carries the same label.
    const confirm = within(screen.getByRole("alertdialog"));
    fireEvent.click(confirm.getByRole("button", { name: "Abbandona" }));

    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith("/rooms/ROOM/leave", {}),
    );
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/"));
  });

  it("finishes collecting before replacing the table with results", async () => {
    mocks.gameHook.gameFinishedData = finishedGame;
    mocks.gameHook.completedTrick = { cards: [], winnerUserId: 1, roundId: 30 };
    const view = renderGameTable();
    await screen.findByTestId("game-layout");
    expect(screen.queryByRole("button", { name: "Torna alla Home" })).not.toBeInTheDocument();
    mocks.gameHook.completedTrick = undefined;
    view.rerender(gameTableRoute());
    await screen.findByRole("button", { name: "Torna alla Home" });
    expect(screen.queryByTestId("game-layout")).not.toBeInTheDocument();
  });

  it("offers no mid-play abandon after a practice game finishes", async () => {
    usePracticeRoom();
    mocks.gameHook.gameFinishedData = finishedGame;
    renderGameTable();

    await screen.findByRole("button", { name: "Torna alla Home" });
    expect(
      screen.queryByTestId("abandon-practice-button"),
    ).not.toBeInTheDocument();
  });

  it.each([false, true])("confirms permanent multiplayer abandonment, including during briscola selection (%s)", async (choosingBriscola) => {
    if (choosingBriscola) mocks.gameHook.currentRound.briscola = null;
    renderGameTable();
    fireEvent.click(await screen.findByTestId("abandon-multiplayer-button"));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("L'abbandono è definitivo");
    expect(screen.queryByTestId("pause-practice-button")).not.toBeInTheDocument();
    expect(mocks.apiPost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(mocks.apiPost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("abandon-multiplayer-button"));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Abbandona" }));
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/rooms/ROOM/leave", {}));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/"));
  });

  it("keeps turn and system messages in their own central area while a trick is in play", async () => {
    mocks.gameHook.playedCards = [{ playerId: 11, userId: 2, suit: "spade", value: "tre", position: 0 }];
    mocks.gameHook.notice = "bob si è disconnesso. Il suo posto resta riservato.";
    renderGameTable();
    const status = await screen.findByTestId("table-status");
    expect(status).toHaveTextContent("Tocca a te");
    expect(status).toHaveTextContent("Il suo posto resta riservato.");
    expect(status.closest(".arcade-arena")).not.toBeNull();
    expect(screen.getByTestId("game-table-center")).toContainElement(status);
    expect(screen.getByTestId("table-card-position-left")).not.toContainElement(status);
    expect(screen.getByTestId("table-card-position-left")).toBeInTheDocument();
  });

  it("lets an AFK player reclaim control without sending a card while a bot owns the seat", async () => {
    mocks.gameHook.playerControls = [{ userId: 1, botModel: "forte", abandonedAt: null }];
    renderGameTable();
    const resume = await screen.findByRole("button", { name: "Riprendi controllo" });
    expect(screen.getByTestId("table-status")).toHaveTextContent("Il bot gioca al tuo posto");
    expect(screen.getByTestId("hand-card-coppe-asso")).toBeDisabled();
    expect(screen.queryByTestId("trump-suit-dialog")).not.toBeInTheDocument();
    fireEvent.click(resume);
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledWith("/rooms/ROOM/resume-control", {}));
    expect(mocks.gameHook.refetchGameState).toHaveBeenCalledOnce();
    expect(mocks.navigate).not.toHaveBeenCalled();
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
        "Impossibile abbandonare la partita. Riprova.",
      ),
    );
    expect(mocks.navigate).not.toHaveBeenCalled();

    expect(mocks.gameHook.setRequestsEnabled).toHaveBeenLastCalledWith(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Torna alla Home" }),
    );

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/"));
    expect(mocks.apiPost).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });
});
