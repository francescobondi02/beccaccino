import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TableCenter from "@/components/TableCenter";

describe("TableCenter", () => {
  const renderCenter = (overrides = {}) =>
    render(
      <TableCenter
        cards={[]}
        {...overrides}
      />,
    );

  it("leaves an empty table free of messages", () => {
    renderCenter();
    expect(screen.getByTestId("game-table-center")).toBeEmptyDOMElement();
  });

  it("shows the played cards instead of the waiting text", () => {
    renderCenter({
      cards: [
        { userId: 1, suit: "denara", value: "asso", position: "bottom" },
        { userId: 2, suit: "coppe", value: "tre", position: "top" },
        { userId: 3, suit: "spade", value: "re", position: "left" },
        { userId: 4, suit: "bastoni", value: "sette", position: "right" },
      ],
    });

    const center = screen.getByTestId("game-table-center");
    expect(center.querySelectorAll("img")).toHaveLength(4);
    expect(screen.getByTestId("card-denara-asso")).toHaveClass(
      "xl:w-20",
      "xl:h-28",
    );
    expect(screen.getByTestId("table-card-position-bottom")).toHaveClass(
      "bottom-10",
      "[@media(max-height:800px)]:bottom-6",
    );
    expect(screen.getByTestId("table-card-position-top")).toHaveClass(
      "top-10",
      "[@media(max-height:800px)]:top-6",
    );
    expect(screen.getByTestId("table-card-position-left")).toHaveClass(
      "left-8",
      "[@media(max-height:800px)]:left-4",
    );
    expect(screen.getByTestId("table-card-position-right")).toHaveClass(
      "right-8",
      "[@media(max-height:800px)]:right-4",
    );
    expect(
      screen.getByTestId("table-card-position-bottom").firstElementChild,
    ).toHaveClass("animate-table-card-from-bottom");
    expect(
      screen.getByTestId("table-card-position-top").firstElementChild,
    ).toHaveClass("animate-table-card-from-top");
    expect(
      screen.getByTestId("table-card-position-left").firstElementChild,
    ).toHaveClass("animate-table-card-from-left");
    expect(
      screen.getByTestId("table-card-position-right").firstElementChild,
    ).toHaveClass("animate-table-card-from-right");
    expect(screen.queryByText(/In attesa/)).not.toBeInTheDocument();
  });

  it("shrinks only the table circle on short desktop viewports", () => {
    renderCenter();

    expect(screen.getByTestId("game-table-center")).toHaveClass(
      "w-[25rem]",
      "h-[25rem]",
      "[@media(max-height:800px)]:w-72",
      "[@media(max-height:800px)]:h-72",
      "[@media(max-height:800px)]:translate-y-6",
    );
  });
});
