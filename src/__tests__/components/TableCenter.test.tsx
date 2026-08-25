import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TableCenter from "@/components/TableCenter";

describe("TableCenter", () => {
  const renderCenter = (overrides = {}) =>
    render(
      <TableCenter
        cards={[]}
        briscolaChosen
        waitingForUsername="anna"
        countdown={null}
        {...overrides}
      />,
    );

  it("waits for the briscola before anything else", () => {
    renderCenter({ briscolaChosen: false });
    expect(
      screen.getByText("anna sta selezionando la briscola..."),
    ).toBeInTheDocument();
  });

  it("names the player everyone is waiting for, with the countdown", () => {
    renderCenter({ countdown: 42 });
    expect(screen.getByText("In attesa di anna...")).toBeInTheDocument();
    expect(screen.getByText("42s")).toBeInTheDocument();
  });

  it("shows the played cards instead of the waiting text", () => {
    renderCenter({
      cards: [
        { userId: 1, suit: "denara", value: "asso", position: "bottom" },
        { userId: 2, suit: "coppe", value: "tre", position: "top" },
      ],
    });

    const center = screen.getByTestId("game-table-center");
    expect(center.querySelectorAll("img")).toHaveLength(2);
    expect(screen.queryByText(/In attesa/)).not.toBeInTheDocument();
  });
});
