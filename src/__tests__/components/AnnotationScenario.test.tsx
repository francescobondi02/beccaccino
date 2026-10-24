import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AnnotationScenario from "@/components/AnnotationScenario";
import type {
  AnnotationChooseBriscolaScenario,
  AnnotationPlayCardScenario,
} from "@/annotations/model";

function createScenario(
  overrides: Partial<AnnotationPlayCardScenario> = {},
): AnnotationPlayCardScenario {
  return {
    id: 17,
    code: "initial-v1-0017",
    stateHash: "scenario-hash",
    decisionType: "play_card",
    targetPoints: 41,
    roundNumber: 3,
    actingSeat: 2,
    callerSeat: 1,
    trickStarter: 2,
    briscola: "coppe",
    totalScores: { 0: 35, 1: 17 },
    hand: [
      { suit: "coppe", value: "asso" },
      { suit: "spade", value: "re" },
    ],
    completedTricks: [
      {
        number: 1,
        starterSeat: 1,
        winnerSeat: 2,
        signal: "busso",
        signalSeat: 1,
        plays: [
          { seat: 1, position: 0, suit: "coppe", value: "quattro" },
          { seat: 2, position: 1, suit: "coppe", value: "asso" },
          { seat: 3, position: 2, suit: "coppe", value: "sette" },
          { seat: 0, position: 3, suit: "coppe", value: "cinque" },
        ],
      },
    ],
    currentTrick: {
      number: 2,
      starterSeat: 2,
      signal: null,
      signalSeat: null,
      plays: [],
    },
    legalActions: [
      { suit: "coppe", value: "asso", signal: "striscio" },
      { suit: "coppe", value: "asso", signal: "busso" },
      { suit: "coppe", value: "asso", signal: "volo" },
      { suit: "coppe", value: "asso", signal: null },
    ],
    ...overrides,
  };
}

function createBriscolaScenario(
  overrides: Partial<AnnotationChooseBriscolaScenario> = {},
): AnnotationChooseBriscolaScenario {
  return {
    id: 18,
    code: "briscola-v2-0018",
    stateHash: "briscola-hash",
    decisionType: "choose_briscola",
    targetPoints: 41,
    roundNumber: 4,
    actingSeat: 2,
    callerSeat: 2,
    totalScores: { 0: 35, 1: 17 },
    hand: [
      { suit: "coppe", value: "asso" },
      { suit: "spade", value: "re" },
      { suit: "denara", value: "tre" },
      { suit: "bastoni", value: "sette" },
      { suit: "coppe", value: "due" },
      { suit: "spade", value: "quattro" },
      { suit: "denara", value: "cinque" },
      { suit: "bastoni", value: "sei" },
      { suit: "coppe", value: "fante" },
      { suit: "spade", value: "cavallo" },
    ],
    legalActions: ["denara", "coppe", "spade", "bastoni"],
    ...overrides,
  };
}

function renderScenario(
  overrides: Partial<React.ComponentProps<typeof AnnotationScenario>> = {},
) {
  const props = {
    scenario: createScenario(),
    startedAt: Date.now() - 1000,
    isSubmitting: false,
    onConfirm: vi.fn(),
    onSkip: vi.fn(),
    ...overrides,
  };
  return { ...render(<AnnotationScenario {...props} />), props };
}

describe("AnnotationScenario", () => {
  it("asks for perceived difficulty only after a complete leader decision", () => {
    const { props } = renderScenario();
    const confirm = screen.getByRole("button", { name: "Conferma scelta" });

    fireEvent.click(
      screen.getByRole("button", { name: "Seleziona asso di coppe" }),
    );
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Niente" }));
    fireEvent.click(confirm);

    expect(screen.getByText("Quanto era difficile?")).toBeInTheDocument();
    expect(screen.queryByText(/predett/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    fireEvent.click(screen.getByRole("button", { name: "Invia risposta" }));

    expect(props.onConfirm).toHaveBeenCalledWith(
      {
        decisionType: "play_card",
        suit: "coppe",
        value: "asso",
        signal: null,
      },
      "medium",
      expect.any(Number),
    );
  });

  it("lets a follower rate a legal null-signal action", () => {
    const onConfirm = vi.fn();
    renderScenario({
      scenario: createScenario({
        trickStarter: 1,
        currentTrick: {
          number: 2,
          starterSeat: 1,
          signal: "striscio",
          signalSeat: 1,
          plays: [
            {
              seat: 1,
              position: 0,
              suit: "coppe",
              value: "quattro",
            },
          ],
        },
        legalActions: [{ suit: "coppe", value: "asso", signal: null }],
      }),
      onConfirm,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Seleziona asso di coppe" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Conferma scelta" }));
    fireEvent.click(screen.getByRole("button", { name: "Facile" }));
    fireEvent.click(screen.getByRole("button", { name: "Invia risposta" }));

    expect(onConfirm).toHaveBeenCalledWith(
      {
        decisionType: "play_card",
        suit: "coppe",
        value: "asso",
        signal: null,
      },
      "easy",
      expect.any(Number),
    );
  });

  it("shows the full hand and submits a briscola choice without trick context", () => {
    const onConfirm = vi.fn();
    renderScenario({
      scenario: createBriscolaScenario(),
      onConfirm,
    });

    expect(
      screen.getByText("4 · obiettivo 41"),
    ).toBeInTheDocument();
    expect(screen.getByText("Tu")).toBeInTheDocument();
    expect(screen.getByText("5 punti + 2 figure")).toBeInTheDocument();
    expect(screen.getByText("11 punti + 2 figure")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("annotation-briscola-hand")).getAllByRole(
        "img",
      ),
    ).toHaveLength(10);
    expect(
      screen.getAllByRole("radio", { name: /come briscola$/ }),
    ).toHaveLength(4);
    expect(screen.queryByText("Presa in corso")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Apri storico della smazzata" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/^Briscola$/)).not.toBeInTheDocument();

    const confirm = screen.getByRole("button", { name: "Conferma scelta" });
    expect(confirm).toBeDisabled();
    fireEvent.click(
      screen.getByRole("radio", {
        name: "Scegli Coppe come briscola",
      }),
    );
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    fireEvent.click(screen.getByRole("button", { name: "Invia risposta" }));

    expect(onConfirm).toHaveBeenCalledWith(
      { decisionType: "choose_briscola", suit: "coppe" },
      "medium",
      expect.any(Number),
    );
  });

  it("collects a skip comment and difficulty without adding comment time", () => {
    const onSkip = vi.fn();
    renderScenario({ onSkip });

    fireEvent.click(screen.getByRole("button", { name: "Non sono sicuro" }));
    fireEvent.change(screen.getByLabelText("Perché non sei sicuro?"), {
      target: { value: "  Non ricordo se il tre è già uscito.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continua" }));
    fireEvent.click(screen.getByRole("button", { name: "Difficile" }));
    fireEvent.click(screen.getByRole("button", { name: "Invia risposta" }));

    expect(onSkip).toHaveBeenCalledWith(
      "Non ricordo se il tre è già uscito.",
      "hard",
      expect.any(Number),
    );
  });

  it("keeps a failed decision in the difficulty dialog for an identical retry", () => {
    const onConfirm = vi.fn();
    const { props, rerender } = renderScenario({ onConfirm });
    fireEvent.click(
      screen.getByRole("button", { name: "Seleziona asso di coppe" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Niente" }));
    fireEvent.click(screen.getByRole("button", { name: "Conferma scelta" }));
    fireEvent.click(screen.getByRole("button", { name: "Media" }));
    fireEvent.click(screen.getByRole("button", { name: "Invia risposta" }));

    const firstPayload = onConfirm.mock.calls[0];
    rerender(
      <AnnotationScenario
        {...props}
        errorMessage="Impossibile registrare la risposta. Riprova."
      />,
    );

    const dialog = screen.getByRole("dialog", {
      name: "Quanto era difficile?",
    });
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Impossibile registrare la risposta. Riprova.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Media" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Invia risposta" }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(onConfirm.mock.calls[1]).toEqual(firstPayload);
  });

  it("offers an explicit replacement action for a stale scenario", () => {
    const onLoadAnotherScenario = vi.fn();
    renderScenario({
      errorMessage:
        "Questo scenario non è più disponibile. Caricane un altro.",
      onLoadAnotherScenario,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Seleziona asso di coppe" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Niente" }));
    fireEvent.click(screen.getByRole("button", { name: "Conferma scelta" }));
    fireEvent.click(screen.getByRole("button", { name: "Media" }));

    const dialog = screen.getByRole("dialog", {
      name: "Quanto era difficile?",
    });
    expect(
      within(dialog).getByRole("button", { name: "Invia risposta" }),
    ).toBeDisabled();
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Carica un altro scenario",
      }),
    );

    expect(onLoadAnotherScenario).toHaveBeenCalledOnce();
  });

  it("shows completed and current public tricks in the shared history dialog", () => {
    renderScenario({
      scenario: createScenario({
        currentTrick: {
          number: 2,
          starterSeat: 2,
          signal: "volo",
          signalSeat: 2,
          plays: [
            {
              seat: 2,
              position: 0,
              suit: "spade",
              value: "re",
            },
          ],
        },
      }),
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Apri storico della smazzata" }),
    );
    const history = screen.getByTestId("annotation-history");
    expect(within(history).getByText("Presa 1")).toBeInTheDocument();
    expect(within(history).getByText("Presa 2 · in corso")).toBeInTheDocument();
    expect(within(history).getByText("busso")).toBeInTheDocument();
    expect(within(history).getByText("volo")).toBeInTheDocument();
  });
});
