import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SignalDialog from "@/components/SignalDialog";

describe("SignalDialog", () => {
  it("describes Striscio by card count without implying strength", () => {
    render(<SignalDialog open onSelect={vi.fn()} />);

    expect(
      screen.getByText(
        "Inclusa la carta giocata, ho almeno 3 carte di questo seme",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Sono forte in questo seme"),
    ).not.toBeInTheDocument();
  });
});
