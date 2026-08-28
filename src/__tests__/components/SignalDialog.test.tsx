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

  it("keeps practice actions reachable inside the mandatory dialog", () => {
    const onPause = vi.fn();
    const onLeave = vi.fn();
    render(
      <SignalDialog
        open
        onSelect={vi.fn()}
        practiceActions={
          <div>
            <button type="button" onClick={onPause}>
              Pausa e torna alla home
            </button>
            <button type="button" onClick={onLeave}>
              Abbandona
            </button>
          </div>
        }
      />,
    );

    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(
      dialog.getByRole("button", { name: "Pausa e torna alla home" }),
    );
    fireEvent.click(dialog.getByRole("button", { name: "Abbandona" }));

    expect(onPause).toHaveBeenCalledOnce();
    expect(onLeave).toHaveBeenCalledOnce();
  });
});
