import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PlayerSeat from "@/components/PlayerSeat";

describe("PlayerSeat", () => {
  const player = { userId: 7, username: "anna", isTeammate: true };

  it("shows the username, and the role only when asked", () => {
    const { rerender } = render(<PlayerSeat player={player} isTurn={false} />);
    expect(screen.getByText("anna")).toBeInTheDocument();
    expect(screen.queryByText("Socio")).not.toBeInTheDocument();

    rerender(<PlayerSeat player={player} isTurn={false} showRole />);
    expect(screen.getByText("Socio")).toBeInTheDocument();

    rerender(
      <PlayerSeat player={{ ...player, isTeammate: false }} isTurn={false} showRole />,
    );
    expect(screen.getByText("Avversario")).toBeInTheDocument();
  });

  it("highlights the seat whose turn it is", () => {
    render(<PlayerSeat player={player} isTurn testId="player-seat-top" />);

    const seat = screen.getByTestId("player-seat-top");
    expect(seat.className).toContain("ring-2");
    expect(seat).toHaveAttribute("data-is-turn", "true");
  });

  it("shows the countdown only for the seat on turn", () => {
    const { rerender } = render(
      <PlayerSeat player={player} isTurn countdown={25} />,
    );
    expect(screen.getByText("25s")).toBeInTheDocument();

    // Not this seat's turn: a stale countdown must not render.
    rerender(<PlayerSeat player={player} isTurn={false} countdown={25} />);
    expect(screen.queryByText("25s")).not.toBeInTheDocument();
  });

  it("shows the declared signal", () => {
    render(<PlayerSeat player={player} isTurn={false} signal="busso" />);
    expect(screen.getByText(/busso/i)).toBeInTheDocument();
  });

  it("exposes Playwright attributes only when given a testId", () => {
    const { container, rerender } = render(
      <PlayerSeat player={player} isTurn={false} testId="player-seat-bottom" />,
    );
    const seat = screen.getByTestId("player-seat-bottom");
    expect(seat).toHaveAttribute("data-userid", "7");
    expect(seat).toHaveAttribute("data-is-turn", "false");

    rerender(<PlayerSeat player={player} isTurn={false} />);
    expect(container.querySelector("[data-testid]")).toBeNull();
  });
});
