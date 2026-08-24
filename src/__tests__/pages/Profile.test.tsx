import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Profile from "@/pages/Profile";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn<(path: string) => Promise<unknown>>(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

vi.mock("@/lib/api", () => mocks);
vi.mock("@/lib/sentryUser", () => ({
  setSentryUser: vi.fn(),
  clearSentryUser: vi.fn(),
}));
vi.mock("@/components/Header", () => ({
  default: ({ username }: { username?: string }) => (
    <div data-testid="header-user">{username}</div>
  ),
}));
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function renderProfile() {
  return render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>,
  );
}

describe("Profile request states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
  });

  it("shows a retryable error instead of zero statistics", async () => {
    let statsAttempts = 0;
    mocks.apiGet.mockImplementation((path) => {
      if (path === "/users/me") {
        return Promise.resolve({ id: 1, username: "alice" });
      }
      if (path === "/users/me/stats") {
        statsAttempts += 1;
        return statsAttempts === 1
          ? Promise.reject(new Error("network unavailable"))
          : Promise.resolve({
              totalGames: 0,
              wins: 0,
              winRate: 0,
              totalPoints: 0,
              recentGames: [],
            });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    renderProfile();

    expect(
      await screen.findByText("Impossibile caricare le statistiche"),
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
        screen.queryByText("Impossibile caricare le statistiche"),
      ).not.toBeInTheDocument(),
    );
  });

  it("renders returned statistics and recent games", async () => {
    mocks.apiGet.mockImplementation((path) => {
      if (path === "/users/me") {
        return Promise.resolve({ id: 1, username: "alice" });
      }
      if (path === "/users/me/stats") {
        return Promise.resolve({
          totalGames: 7,
          wins: 4,
          winRate: 57,
          totalPoints: 83,
          recentGames: [
            {
              id: 9,
              code: "ROOM",
              date: "2026-08-24T12:00:00.000Z",
              result: "Vittoria",
              myTeamPoints: 6,
              opponentTeamPoints: 3,
              teammates: ["carla"],
              opponents: ["bob", "diego"],
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });

    renderProfile();

    expect(await screen.findByText("vs bob, diego")).toBeInTheDocument();
    expect(screen.getByText("83")).toBeInTheDocument();
    expect(screen.getByText("Vittoria")).toBeInTheDocument();
  });
});
