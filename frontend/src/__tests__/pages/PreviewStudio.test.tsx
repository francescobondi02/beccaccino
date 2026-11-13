import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PreviewStudio from "@/preview/PreviewStudio";

describe("isolated UI preview", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })));
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens a sample room, plays cards, and resets without contacting the backend", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<PreviewStudio />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("NON È SOLO FORTUNA.");
    fireEvent.click(screen.getByRole("button", { name: "Prova Ancora una, poi basta." }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ancora una, poi basta.");
    expect(within(screen.getByTestId("player-hand")).getAllByRole("button")).toHaveLength(10);
    fireEvent.click(screen.getByTestId("hand-card-denara-asso"));
    fireEvent.click(screen.getByTestId("signal-button-busso"));
    expect(screen.queryByTestId("hand-card-denara-asso")).not.toBeInTheDocument();
    expect(screen.getByTestId("table-card-position-bottom")).toBeInTheDocument();
    const controls = screen.getByRole("complementary", { name: "Comandi del tavolo demo" });
    expect(within(controls).getByRole("status")).toHaveTextContent("La tua carta è in tavola · busso");

    fireEvent.click(screen.getByRole("button", { name: "Ricomincia" }));
    expect(screen.getByTestId("hand-card-denara-asso")).toBeEnabled();
    expect(within(screen.getByTestId("player-hand")).getAllByRole("button")).toHaveLength(10);
    expect(screen.queryByTestId("table-card-position-bottom")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("completes a four-card trick with distinct cards and returns to the lobby", () => {
    render(<PreviewStudio />);
    fireEvent.click(screen.getByRole("button", { name: "FAMMI GIOCARE" }));
    fireEvent.click(screen.getByTestId("hand-card-spade-sette"));
    fireEvent.click(screen.getByTestId("signal-button-none"));
    fireEvent.click(screen.getByRole("button", { name: "Completa la presa" }));
    const cards = within(screen.getByTestId("game-table-center")).getAllByRole("img");
    expect(cards).toHaveLength(4);
    expect(new Set(cards.map((card) => card.getAttribute("src"))).size).toBe(4);
    fireEvent.click(screen.getByRole("button", { name: "Tutti i tavoli" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("NON È SOLO FORTUNA.");
    expect(screen.getByRole("link", { name: /Torna alla versione attuale/ })).toHaveAttribute("href", "/");
  });

  it("opens accessible rules without leaving the preview", () => {
    render(<PreviewStudio />);
    fireEvent.click(screen.getByRole("button", { name: "Come si gioca" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading")).toHaveTextContent("Tre dritte.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Chiudi le regole" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lets the user pause and restart decorative motion", () => {
    const { container } = render(<PreviewStudio />);
    fireEvent.click(screen.getByRole("button", { name: "Pausa effetti" }));
    expect(container.querySelector(".club-preview")).toHaveAttribute("data-motion", "off");
    expect(screen.getByRole("button", { name: "Attiva effetti" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Attiva effetti" }));
    expect(screen.getByRole("button", { name: "Pausa effetti" })).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector(".club-preview")).toHaveAttribute("data-motion", "off");
  });

  it("stops movement when the system motion preference changes while open", () => {
    let reduced = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      get matches() { return reduced; },
      addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })));
    const { container } = render(<PreviewStudio />);
    expect(container.querySelector(".club-preview")).toHaveAttribute("data-motion", "on");
    act(() => {
      reduced = true;
      listeners.forEach((listener) => listener());
    });
    expect(container.querySelector(".club-preview")).toHaveAttribute("data-motion", "off");
  });
});
