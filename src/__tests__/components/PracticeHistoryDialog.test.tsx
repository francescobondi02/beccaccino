import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PracticeHistoryDialog from "@/components/PracticeHistoryDialog";
import type { MoveLogEntry } from "@/game/model";

describe("PracticeHistoryDialog", () => {
  const moves: MoveLogEntry[] = [
    {
      handNumber: 1,
      username: "Anna",
      suit: "denara",
      value: "quattro",
      signal: "busso",
    },
    {
      handNumber: 1,
      username: "Paolo",
      suit: "coppe",
      value: "asso",
      signal: null,
    },
    {
      handNumber: 2,
      username: "Paolo",
      suit: "bastoni",
      value: "re",
      signal: "striscio",
    },
  ];

  const hands = [
    {
      userId: 1,
      botModel: null,
      cards: [{ suit: "spade", value: "sette" }],
    },
    {
      userId: 2,
      botModel: "forte",
      cards: [{ suit: "denara", value: "re" }],
    },
  ];

  const renderDialog = (
    overrides: Partial<
      React.ComponentProps<typeof PracticeHistoryDialog>
    > = {},
  ) =>
    render(
      <PracticeHistoryDialog
        open
        onOpenChange={vi.fn()}
        moveLog={moves}
        hands={hands}
        handsRevealed={false}
        onToggleHands={vi.fn()}
        usernameOf={(id) => (id === 1 ? "Paolo" : "Anna")}
        {...overrides}
      />,
    );

  it("groups card images and signals by trick", () => {
    renderDialog();

    const history = screen.getByTestId("practice-history");
    expect(within(history).queryByText(/Round/)).not.toBeInTheDocument();
    expect(within(history).getByText("Mano 1")).toBeInTheDocument();
    expect(within(history).getByText("Mano 2")).toBeInTheDocument();
    expect(
      within(history).getByAltText("quattro di denara"),
    ).toBeInTheDocument();
    expect(within(history).getByAltText("asso di coppe")).toBeInTheDocument();
    expect(within(history).getByText("busso")).toBeInTheDocument();
    expect(within(history).getByText("striscio")).toBeInTheDocument();
  });

  it("keeps hands hidden until explicitly revealed", () => {
    const onToggleHands = vi.fn();
    renderDialog({ onToggleHands });

    expect(screen.queryByAltText("re di denara")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mostra mani" }));
    expect(onToggleHands).toHaveBeenCalledOnce();

    renderDialog({ handsRevealed: true });
    expect(screen.getByAltText("re di denara")).toBeInTheDocument();
    expect(screen.getByAltText("sette di spade")).toBeInTheDocument();
    expect(screen.getByText("forte")).toBeInTheDocument();
  });

  it("omits hand controls when the server provides no hands", () => {
    renderDialog({ hands: null });

    expect(
      screen.queryByTestId("toggle-reveal-hands"),
    ).not.toBeInTheDocument();
  });

  it("shows an empty history state", () => {
    renderDialog({ moveLog: [] });

    expect(screen.getByText("Nessuna carta giocata.")).toBeInTheDocument();
  });
});
