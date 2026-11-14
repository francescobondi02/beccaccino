import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SignalCallout from "@/components/game/SignalCallout";
import GameBoard from "@/components/game/GameBoard";
import { positionPlayers } from "@/game/presentation";
import type { PlayedCard } from "@contract/game";

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
      userId: seat + 1, username, isBot: false, seat, team: seat % 2 === 0 ? 0 : 1,
      botModel: null, abandoned: false,
    }) as const), 1);
    const lead: PlayedCard = { userId: 1, suit: "denara", value: "asso", signal: "busso" };
    const board = (playedCards: PlayedCard[]) => {
      const first = playedCards[0];
      return (
        <GameBoard players={players} currentTurnUserId={null}
          currentSignal={first.signal ? { userId: first.userId, signal: first.signal, cardKey: `${first.suit}-${first.value}` } : null}
          countdown={null} playedCards={playedCards} briscola="denara"
          callerUserId={1} currentUserId={1} hand={[]} playableCards={[]} onCardClick={vi.fn()} />
      );
    };
    const { rerender } = render(board([lead]));
    act(() => vi.advanceTimersByTime(2800));
    rerender(board([lead, { ...lead, userId: 2, signal: null }]));
    expect(screen.queryByText("busso!")).not.toBeInTheDocument();
    rerender(board([{ ...lead, value: "tre" }]));
    expect(screen.getByText("busso!")).toBeInTheDocument();
  });
});
