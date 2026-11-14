import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GameResult from "@/components/GameResult";
import type { GameResult as GameResultData } from "@contract/game";

function result(): GameResultData {
  return {
    winnerTeam: 0, totalRounds: 1,
    finalScores: { team0: 7, team1: 4 },
    roundsWon: { team0: 1, team1: 0 },
    statistics: {
      players: ["Anna", "Luca", "Marta", "Diego"].map((username, seat) => ({
        username, team: seat % 2 === 0 ? 0 : 1, tricksWon: seat < 2 ? 5 : 0,
        busso: seat < 2 ? 2 : 0, acesCaptured: seat === 2 ? 2 : 0,
        acesLost: seat === 1 ? 2 : 0,
      })),
      rounds: [{ number: 1, winnerTeam: 0, score: { team0: { points: 7, figures: 1 }, team1: { points: 4, figures: 1 } } }],
    },
  };
}

describe("GameResult", () => {
  it("shows tied awards, team totals and round figures without a dialog", () => {
    render(<GameResult result={result()} myTeam={0} onHome={vi.fn()} isReturningHome={false} />);
    expect(screen.getByRole("heading", { name: "Vittoria!" })).toHaveFocus();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const busso = screen.getByRole("heading", { name: "Il bussatore" }).parentElement!;
    expect(within(busso).getByText("Anna, Luca")).toBeInTheDocument();
    expect(within(busso).getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cacciatore di assi" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Assi in fuga" })).toBeInTheDocument();
    expect(screen.getByText("7 punti · 1 figure")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Torna alla lobby" })).toBeEnabled();
  });

  it("omits zero-count awards and keeps exit disabled while leaving", () => {
    const data = result();
    data.statistics.players.forEach((player) => {
      player.busso = 0;
      player.acesCaptured = 0;
      player.acesLost = 0;
    });
    render(<GameResult result={data} myTeam={1} onHome={vi.fn()} isReturningHome />);
    expect(screen.queryByRole("heading", { name: "Premi della partita" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Partita terminata" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uscita in corso..." })).toBeDisabled();
  });
});
