import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PracticePanel from "@/components/PracticePanel";
import { MoveLogEntry } from "@/components/MoveLog";

/**
 * The practice panel is the diagnostic: it has to make a bot's signals
 * reviewable after the fact, and its revealed hands are what turn "the bot said
 * volo" into "the bot lied". These tests pin the parts that would silently stop
 * being useful — a dropped signal badge, or hands leaking when not revealed.
 */
describe("PracticePanel", () => {
  const moves: MoveLogEntry[] = [
    { handNumber: 1, username: "Anna (bot)", suit: "denara", value: "quattro", signal: "busso" },
    { handNumber: 1, username: "io", suit: "coppe", value: "asso", signal: null },
  ];

  const hands = [
    { userId: 1, botModel: null, cards: [{ suit: "spade", value: "tre" }] },
    { userId: 2, botModel: "forte", cards: [{ suit: "denara", value: "re" }] },
  ];

  const usernameOf = (id: number) => (id === 1 ? "io" : "Anna (bot)");

  const renderPanel = (overrides = {}) =>
    render(
      <PracticePanel
        moveLog={moves}
        hands={hands}
        revealed={false}
        onToggleReveal={vi.fn()}
        usernameOf={usernameOf}
        {...overrides}
      />,
    );

  it("lists every move with the signal its leader declared", () => {
    renderPanel();

    expect(screen.getByText(/quattro di denara/)).toBeInTheDocument();
    expect(screen.getByText("busso")).toBeInTheDocument();
    expect(screen.getByText(/asso di coppe/)).toBeInTheDocument();
  });

  it("keeps hands hidden until revealed", () => {
    renderPanel();

    // The whole point of the toggle: cards must not be on screen by default,
    // otherwise practice play is indistinguishable from cheating.
    expect(screen.queryByText(/re di denara/)).not.toBeInTheDocument();

    renderPanel({ revealed: true });
    expect(screen.getByText(/re di denara/)).toBeInTheDocument();
  });

  it("labels a revealed hand with the tier driving that seat", () => {
    renderPanel({ revealed: true });

    // The tier badge sits next to the seat's name, so you can tell which model
    // played the hand you are looking at.
    const tierBadge = screen.getByText("forte");
    expect(tierBadge).toBeInTheDocument();
    expect(tierBadge.parentElement).toHaveTextContent("Anna (bot)");
  });

  it("toggles on click", () => {
    const onToggleReveal = vi.fn();
    renderPanel({ onToggleReveal });

    fireEvent.click(screen.getByTestId("toggle-reveal-hands"));
    expect(onToggleReveal).toHaveBeenCalledTimes(1);
  });

  it("omits the reveal card entirely outside practice games", () => {
    // `hands` is null whenever the server did not mark the room as practice.
    renderPanel({ hands: null });

    expect(screen.queryByTestId("toggle-reveal-hands")).not.toBeInTheDocument();
    expect(screen.getByText("Storico mosse")).toBeInTheDocument();
  });

  it("says so when nothing has been played yet", () => {
    renderPanel({ moveLog: [] });

    expect(screen.getByText("Nessuna carta giocata.")).toBeInTheDocument();
  });
});
