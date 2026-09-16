import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_QUERY_KEY, useAuth, type AuthUser } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiGet: mocks.apiGet,
    apiPost: mocks.apiPost,
  };
});

const alice: AuthUser = { id: 1, username: "alice" };

function Probe({
  id,
  protectedPage = false,
}: {
  id: string;
  protectedPage?: boolean;
}) {
  const auth = useAuth({ redirectOnFail: protectedPage });

  return (
    <div>
      <span data-testid={`user-${id}`}>
        {auth.user?.username ?? "anonymous"}
      </span>
      <span data-testid={`status-${id}`}>
        {auth.loading ? "loading" : auth.error ? "error" : "ready"}
      </span>
      <button type="button" onClick={() => void auth.retry()}>
        Retry {id}
      </button>
      <button type="button" onClick={() => auth.setUser(alice)}>
        Login {id}
      </button>
      <button
        type="button"
        onClick={() => void auth.logout().catch(() => undefined)}
      >
        Logout {id}
      </button>
    </div>
  );
}

function renderWithAuth(children: React.ReactNode, seed?: AuthUser | null) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  if (seed !== undefined) {
    queryClient.setQueryData(AUTH_QUERY_KEY, seed);
  }

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>,
    ),
  };
}

describe("useAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
  });

  it("shares one current-user request across concurrent consumers", async () => {
    mocks.apiGet.mockResolvedValue(alice);

    renderWithAuth(
      <>
        <Probe id="first" />
        <Probe id="second" />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("user-first")).toHaveTextContent("alice");
      expect(screen.getByTestId("user-second")).toHaveTextContent("alice");
    });
    expect(mocks.apiGet).toHaveBeenCalledTimes(1);
    expect(mocks.apiGet).toHaveBeenCalledWith("/users/me");
  });

  it.each([401, 403])(
    "redirects protected consumers only after a confirmed %s",
    async (status) => {
      mocks.apiGet.mockRejectedValue(new ApiError(status, "Not authenticated"));

      renderWithAuth(<Probe id="protected" protectedPage />);

      expect(await screen.findByTestId("user-protected")).toHaveTextContent(
        "anonymous",
      );
      await waitFor(() =>
        expect(mocks.navigate).toHaveBeenCalledWith("/", { replace: true }),
      );
    },
  );

  it.each([
    ["network", new TypeError("Failed to fetch")],
    ["server", new ApiError(500, "Server error")],
  ])(
    "exposes a retryable %s failure without redirecting",
    async (_label, error) => {
      mocks.apiGet.mockRejectedValueOnce(error).mockResolvedValueOnce(alice);

      renderWithAuth(<Probe id="protected" protectedPage />);

      await waitFor(() =>
        expect(screen.getByTestId("status-protected")).toHaveTextContent(
          "error",
        ),
      );
      expect(mocks.navigate).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "Retry protected" }));

      await waitFor(() =>
        expect(screen.getByTestId("user-protected")).toHaveTextContent("alice"),
      );
      expect(mocks.apiGet).toHaveBeenCalledTimes(2);
      expect(mocks.navigate).not.toHaveBeenCalled();
    },
  );

  it("propagates login and logout to every consumer", async () => {
    mocks.apiPost.mockResolvedValue(undefined);

    renderWithAuth(
      <>
        <Probe id="first" />
        <Probe id="second" />
      </>,
      null,
    );

    fireEvent.click(screen.getByRole("button", { name: "Login first" }));
    await waitFor(() => {
      expect(screen.getByTestId("user-first")).toHaveTextContent("alice");
      expect(screen.getByTestId("user-second")).toHaveTextContent("alice");
    });

    fireEvent.click(screen.getByRole("button", { name: "Logout second" }));

    await waitFor(() => {
      expect(screen.getByTestId("user-first")).toHaveTextContent("anonymous");
      expect(screen.getByTestId("user-second")).toHaveTextContent("anonymous");
    });
    expect(mocks.apiPost).toHaveBeenCalledWith("/users/logout");
    expect(mocks.navigate).toHaveBeenCalledWith("/", { replace: true });
  });

  it("preserves the current user when logout fails", async () => {
    mocks.apiPost.mockRejectedValue(new ApiError(500, "Server error"));

    renderWithAuth(<Probe id="current" />, alice);
    fireEvent.click(screen.getByRole("button", { name: "Logout current" }));

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalled());
    expect(screen.getByTestId("user-current")).toHaveTextContent("alice");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
