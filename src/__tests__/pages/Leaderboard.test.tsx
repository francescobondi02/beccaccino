import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Leaderboard from "@/pages/Leaderboard";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn<(path: string) => Promise<unknown>>(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiGet: mocks.apiGet };
});
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function renderLeaderboard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Leaderboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Leaderboard request states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
  });

  it("shows a retryable error separately from a valid empty leaderboard", async () => {
    let leaderboardAttempts = 0;
    mocks.apiGet.mockImplementation((path) => {
      if (path === "/users/me") {
        return Promise.reject(new Error("auth service unavailable"));
      }
      if (path === "/users/leaderboard") {
        leaderboardAttempts += 1;
        return leaderboardAttempts === 1
          ? Promise.reject(new Error("network unavailable"))
          : Promise.resolve({ leaderboard: [] });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    renderLeaderboard();

    expect(
      await screen.findByText("Impossibile caricare la classifica"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Nessuna partita completata ancora"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));

    expect(
      await screen.findByText("Nessuna partita completata ancora"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByText("Impossibile caricare la classifica"),
      ).not.toBeInTheDocument(),
    );
  });

  it("renders leaderboard data", async () => {
    mocks.apiGet.mockImplementation((path) => {
      if (path === "/users/me") {
        return Promise.resolve({ id: 1, username: "alice" });
      }
      if (path === "/users/leaderboard") {
        return Promise.resolve({
          leaderboard: [
            {
              username: "alice",
              totalGames: 10,
              wins: 8,
              winRate: 80,
              totalPoints: 120,
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    renderLeaderboard();

    expect(await screen.findByText("120")).toBeInTheDocument();
    expect(screen.getAllByText("alice")).toHaveLength(2);
    expect(screen.queryByText("Caricamento classifica...")).not.toBeInTheDocument();
  });
});
