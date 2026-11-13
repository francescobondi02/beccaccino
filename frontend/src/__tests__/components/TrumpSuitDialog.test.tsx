import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TrumpSuitDialog from "@/components/TrumpSuitDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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

  it("keeps pause and leave actions reachable inside the mandatory dialog", () => {
    const onPause = vi.fn();
    const onLeave = vi.fn();
    render(
      <TrumpSuitDialog
        open
        onSelectSuit={vi.fn()}
        myCards={[]}
        practiceActions={
          <div>
            <button type="button" onClick={onPause}>
              Pausa e torna alla home
            </button>
            <AlertDialog>
              <AlertDialogTrigger>Abbandona</AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogTitle>Abbandonare?</AlertDialogTitle>
                <AlertDialogDescription>
                  La partita verrà chiusa.
                </AlertDialogDescription>
                <AlertDialogAction onClick={onLeave}>
                  Conferma
                </AlertDialogAction>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        }
      />,
    );

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Pausa e torna alla home",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Abbandona",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Conferma",
      }),
    );

    expect(onPause).toHaveBeenCalledOnce();
    expect(onLeave).toHaveBeenCalledOnce();
  });
});
