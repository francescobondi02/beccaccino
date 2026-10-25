import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SignalCallout from "@/components/game/SignalCallout";
import GameBoard from "@/components/game/GameBoard";
import { positionPlayers } from "@/game/presentation";
import { gameTableReducer, initialGameTableState, type GameTableState } from "@/game/state";

describe("SignalCallout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("announces the declaring player and disappears without replaying on rerenders", () => {
    const { rerender } = render(<SignalCallout signal="busso" position="left" username="Luca" />);
    expect(screen.getByRole("status")).toHaveTextContent("Luca dichiara busso!");
    act(() => vi.advanceTimersByTime(2000));
    rerender(<SignalCallout signal="busso" position="left" username="Luca" />);
    act(() => vi.advanceTimersByTime(800));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("gives a new declaration its own lifetime and cancels the previous timeout", () => {
    const { rerender } = render(<SignalCallout key="busso" signal="busso" position="top" username="Giulia" />);
    act(() => vi.advanceTimersByTime(2000));
    rerender(<SignalCallout key="volo" signal="volo" position="top" username="Giulia" />);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("status")).toHaveTextContent("Giulia dichiara volo!");
    act(() => vi.advanceTimersByTime(1800));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("cleans up when the signal or game is removed", () => {
    const { unmount } = render(<SignalCallout signal="striscio" position="bottom" username="Alex" />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("replays an identical declaration in the next trick, not when followers play", () => {
    const players = positionPlayers(["Alex", "Luca", "Giulia", "Marta"].map((username, seat) => ({
      id: seat + 1, userId: seat + 1, username, seat, team: seat % 2, isReady: true,
    })), 1);
    const lead = { playerId: 1, userId: 1, suit: "denara", value: "asso", position: 0, signal: "busso" as const };
    let state = gameTableReducer(initialGameTableState, {
      type: "card_played", data: lead, myUserId: 1, username: "Alex",
    });
    const board = (current: GameTableState) => (
      <GameBoard players={players} currentTurnUserId={null} currentSignal={current.currentSignal}
        countdown={null} playedCards={current.playedCards} briscola="denara"
        callerUserId={1} currentUserId={1} hand={[]} playableCards={[]} onCardClick={vi.fn()} />
    );
    const { rerender } = render(board(state));
    act(() => vi.advanceTimersByTime(2800));
    state = gameTableReducer(state, {
      type: "card_played", data: { ...lead, userId: 2, playerId: 2, position: 1, signal: null },
      myUserId: 1, username: "Luca",
    });
    rerender(board(state));
    expect(screen.queryByText("busso!")).not.toBeInTheDocument();
    state = gameTableReducer(state, {
      type: "card_played", data: { ...lead, value: "tre", handNumber: 2 }, myUserId: 1, username: "Alex",
    });
    rerender(board(state));
    expect(screen.getByText("busso!")).toBeInTheDocument();
  });
});
