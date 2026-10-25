import { fireEvent, render, screen, within } from "@testing-library/react";
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

  it("keeps external practice actions reachable without adding them to signal choices", () => {
    const onPause = vi.fn();
    const onLeave = vi.fn();
    render(
      <>
        <button type="button" onClick={onPause}>
          Pausa e torna alla home
        </button>
        <button type="button" onClick={onLeave}>
          Abbandona
        </button>
        <SignalDialog open onSelect={vi.fn()} />
      </>,
    );

    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.queryByRole("button", { name: "Abbandona" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Pausa e torna alla home" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Abbandona" }));

    expect(onPause).toHaveBeenCalledOnce();
    expect(onLeave).toHaveBeenCalledOnce();
  });
});
