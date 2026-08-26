import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TrumpSuitDialog from "@/components/TrumpSuitDialog";

describe("TrumpSuitDialog", () => {
  it("keeps every suit label readable on hover", () => {
    render(
      <TrumpSuitDialog open onSelectSuit={vi.fn()} myCards={[]} />,
    );

    for (const suit of ["denara", "coppe", "spade", "bastoni"]) {
      expect(screen.getByTestId(`suit-button-${suit}`)).toHaveClass(
        "hover:text-foreground",
      );
    }
  });
});
