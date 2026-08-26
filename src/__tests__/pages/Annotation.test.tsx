import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Annotation from "@/pages/Annotation";
import type { AnnotationScenario } from "@/annotations/model";
import { ApiError } from "@/lib/api";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn<(path: string) => Promise<unknown>>(),
  apiPost: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
  clearUser: vi.fn<() => Promise<void>>(),
  retryAuth: vi.fn<() => Promise<void>>(),
  toastSuccess: vi.fn(),
  auth: {
    user: { id: 7, username: "expert" } as {
      id: number;
      username: string;
    } | null,
    loading: false,
    error: null as Error | null,
  },
}));

vi.mock("@/lib/api", () => ({
  apiGet: mocks.apiGet,
  apiPost: mocks.apiPost,
  ApiError: class extends Error {
    constructor(
      public status: number,
      message = "API error",
    ) {
      super(message);
    }
  },
}));
vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    ...mocks.auth,
    clearUser: mocks.clearUser,
    retry: mocks.retryAuth,
  }),
}));
vi.mock("@/components/Header", () => ({
  default: () => <div data-testid="header" />,
}));
vi.mock("@/components/AuthDialog", () => ({
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="auth-dialog" /> : null,
}));

const scenario: AnnotationScenario = {
  id: 31,
  code: "initial-v1-0031",
  stateHash: "state-31",
  targetPoints: 41,
  roundNumber: 2,
  actingSeat: 0,
  callerSeat: 3,
  trickStarter: 1,
  briscola: "bastoni",
  totalScores: { 0: 10, 1: 7 },
  hand: [{ suit: "coppe", value: "asso" }],
  completedTricks: [],
  currentTrick: {
    number: 1,
    starterSeat: 1,
    signal: null,
    signalSeat: null,
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
};

function renderAnnotation() {
  return render(
    <MemoryRouter>
      <Annotation />
    </MemoryRouter>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function submitCurrentScenario() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Seleziona asso di coppe" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Conferma scelta" }));
  fireEvent.click(screen.getByRole("button", { name: "Difficile" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Invia risposta" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("Annotation page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
    mocks.auth.user = { id: 7, username: "expert" };
    mocks.auth.loading = false;
    mocks.auth.error = null;
    mocks.clearUser.mockResolvedValue();
    mocks.retryAuth.mockResolvedValue();
  });

  it("reuses account login before loading annotation data", async () => {
    mocks.auth.user = null;

    renderAnnotation();

    expect(await screen.findByText("Accedi per contribuire")).toBeInTheDocument();
    expect(screen.getByTestId("auth-dialog")).toBeInTheDocument();
    expect(mocks.apiGet).not.toHaveBeenCalled();
  });

  it("retries a temporary authentication bootstrap failure through useAuth", async () => {
    mocks.auth.user = null;
    mocks.auth.error = new Error("network unavailable");

    renderAnnotation();
    fireEvent.click(
      await screen.findByRole("button", { name: "Riprova" }),
    );

    expect(mocks.retryAuth).toHaveBeenCalledOnce();
    expect(mocks.apiGet).not.toHaveBeenCalled();
    expect(screen.queryByTestId("auth-dialog")).not.toBeInTheDocument();
  });

  it("keeps an incorrect access code inline without clearing the account", async () => {
    mocks.apiGet.mockResolvedValue({
      accessGranted: false,
      contributionCount: 0,
    });
    mocks.apiPost.mockRejectedValue(
      new ApiError(400, "Invalid annotation access code"),
    );

    renderAnnotation();
    const codeInput = await screen.findByLabelText("Codice");
    fireEvent.change(codeInput, { target: { value: "wrong-code" } });
    fireEvent.click(screen.getByRole("button", { name: "Continua" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Codice non valido.",
    );
    expect(codeInput).toHaveValue("wrong-code");
    expect(screen.getByText("Codice esperto")).toBeInTheDocument();
    expect(mocks.clearUser).not.toHaveBeenCalled();
  });

  it.each([
    [
      new ApiError(429, "Too many requests"),
      "Troppi tentativi. Riprova tra poco.",
    ],
    [
      new ApiError(503, "Not configured"),
      "Accesso esperti non disponibile. Riprova più tardi.",
    ],
    [
      new ApiError(500, "Server error"),
      "Impossibile verificare il codice. Riprova.",
    ],
    [new Error("network unavailable"), "Impossibile verificare il codice. Riprova."],
  ])("does not mislabel an operational access failure", async (error, message) => {
    mocks.apiGet.mockResolvedValue({
      accessGranted: false,
      contributionCount: 0,
    });
    mocks.apiPost.mockRejectedValue(error);

    renderAnnotation();
    fireEvent.change(await screen.findByLabelText("Codice"), {
      target: { value: "shared-code" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continua" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(mocks.clearUser).not.toHaveBeenCalled();
  });

  it("exchanges the shared code once and persists access on the account", async () => {
    mocks.apiGet
      .mockResolvedValueOnce({ accessGranted: false, contributionCount: 4 })
      .mockResolvedValueOnce({ scenario: null, contributionCount: 4 });
    mocks.apiPost.mockResolvedValue({
      accessGranted: true,
      contributionCount: 4,
    });

    renderAnnotation();
    fireEvent.change(await screen.findByLabelText("Codice"), {
      target: { value: "shared-code" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continua" }));

    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith("/annotations/access", {
        code: "shared-code",
      }),
    );
    expect(
      await screen.findByText("Nuovi scenari in preparazione"),
    ).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it.each(["status", "next", "access", "response"] as const)(
    "opens normal account login when %s returns 401",
    async (requestPoint) => {
      if (requestPoint === "status") {
        mocks.apiGet.mockRejectedValue(new ApiError(401, "Expired"));
      } else if (requestPoint === "next") {
        mocks.apiGet
          .mockResolvedValueOnce({ accessGranted: true, contributionCount: 0 })
          .mockRejectedValueOnce(new ApiError(401, "Expired"));
      } else if (requestPoint === "access") {
        mocks.apiGet.mockResolvedValue({
          accessGranted: false,
          contributionCount: 0,
        });
        mocks.apiPost.mockRejectedValue(new ApiError(401, "Expired"));
      } else {
        mocks.apiGet
          .mockResolvedValueOnce({ accessGranted: true, contributionCount: 0 })
          .mockResolvedValueOnce({ scenario, contributionCount: 0 });
        mocks.apiPost.mockRejectedValue(new ApiError(401, "Expired"));
      }

      renderAnnotation();
      if (requestPoint === "access") {
        fireEvent.change(await screen.findByLabelText("Codice"), {
          target: { value: "shared-code" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Continua" }));
      } else if (requestPoint === "response") {
        await submitCurrentScenario();
      }

      await waitFor(() => expect(mocks.clearUser).toHaveBeenCalledOnce());
      expect(screen.getByTestId("auth-dialog")).toBeInTheDocument();
      expect(screen.getByText("Accedi per contribuire")).toBeInTheDocument();
    },
  );

  it.each(["next", "response"] as const)(
    "returns to the access-code screen when protected %s returns 403",
    async (requestPoint) => {
      mocks.apiGet
        .mockResolvedValueOnce({ accessGranted: true, contributionCount: 0 })
        .mockImplementationOnce(() =>
          requestPoint === "next"
            ? Promise.reject(new ApiError(403, "Expert access required"))
            : Promise.resolve({ scenario, contributionCount: 0 }),
        );
      if (requestPoint === "response") {
        mocks.apiPost.mockRejectedValue(
          new ApiError(403, "Expert access required"),
        );
      }

      renderAnnotation();
      if (requestPoint === "response") {
        await submitCurrentScenario();
      }

      expect(await screen.findByText("Codice esperto")).toBeInTheDocument();
      expect(mocks.clearUser).not.toHaveBeenCalled();
    },
  );

  it("submits the selected action with perceived difficulty then loads another scenario", async () => {
    let nextCalls = 0;
    mocks.apiGet.mockImplementation((path) => {
      if (path === "/annotations/status") {
        return Promise.resolve({ accessGranted: true, contributionCount: 9 });
      }
      if (path === "/annotations/next") {
        nextCalls += 1;
        return Promise.resolve(
          nextCalls === 1
            ? { scenario, contributionCount: 9 }
            : { scenario: null, contributionCount: 10 },
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    mocks.apiPost.mockResolvedValue({ contributionCount: 10 });

    renderAnnotation();
    fireEvent.click(
      await screen.findByRole("button", { name: "Seleziona asso di coppe" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Conferma scelta" }));
    fireEvent.click(screen.getByRole("button", { name: "Difficile" }));
    fireEvent.click(screen.getByRole("button", { name: "Invia risposta" }));

    await waitFor(() =>
      expect(mocks.apiPost).toHaveBeenCalledWith(
        "/annotations/responses",
        expect.objectContaining({
          scenarioId: 31,
          scenarioHash: "state-31",
          selectedAction: {
            suit: "coppe",
            value: "asso",
            signal: null,
          },
          skipped: false,
          perceivedDifficulty: "hard",
          responseTimeMs: expect.any(Number),
        }),
      ),
    );
    expect(
      await screen.findByText("Nuovi scenari in preparazione"),
    ).toBeInTheDocument();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Risposta salvata.");
    expect(screen.queryByText(/\/50/)).not.toBeInTheDocument();
    expect(screen.queryByText("Raccolta completata")).not.toBeInTheDocument();
  });

  it("confirms success only after the response write resolves", async () => {
    const responseWrite = deferred<{ contributionCount: number }>();
    let nextCalls = 0;
    mocks.apiGet.mockImplementation((path) => {
      if (path === "/annotations/status") {
        return Promise.resolve({ accessGranted: true, contributionCount: 9 });
      }
      nextCalls += 1;
      return Promise.resolve(
        nextCalls === 1
          ? { scenario, contributionCount: 9 }
          : { scenario: null, contributionCount: 10 },
      );
    });
    mocks.apiPost.mockReturnValue(responseWrite.promise);

    renderAnnotation();
    await submitCurrentScenario();
    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledOnce());
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(nextCalls).toBe(1);

    await act(async () => {
      responseWrite.resolve({ contributionCount: 10 });
      await responseWrite.promise;
    });

    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Risposta salvata."),
    );
    expect(
      await screen.findByText("Nuovi scenari in preparazione"),
    ).toBeInTheDocument();
    expect(nextCalls).toBe(2);
  });

  it("keeps a failed response available and retries the identical payload", async () => {
    let nextCalls = 0;
    mocks.apiGet.mockImplementation((path) => {
      if (path === "/annotations/status") {
        return Promise.resolve({ accessGranted: true, contributionCount: 0 });
      }
      nextCalls += 1;
      return Promise.resolve(
        nextCalls === 1
          ? { scenario, contributionCount: 0 }
          : { scenario: null, contributionCount: 1 },
      );
    });
    mocks.apiPost
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ contributionCount: 1 });

    renderAnnotation();
    await submitCurrentScenario();

    const dialog = await screen.findByRole("dialog", {
      name: "Quanto era difficile?",
    });
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Impossibile registrare la risposta. Riprova.",
    );
    const firstPayload = mocks.apiPost.mock.calls[0][1];
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Invia risposta" }),
    );

    expect(
      await screen.findByText("Nuovi scenari in preparazione"),
    ).toBeInTheDocument();
    expect(mocks.apiPost).toHaveBeenCalledTimes(2);
    expect(mocks.apiPost.mock.calls[1][1]).toEqual(firstPayload);
  });

  it("retries only the next load when saving succeeded first", async () => {
    let nextCalls = 0;
    mocks.apiGet.mockImplementation((path) => {
      if (path === "/annotations/status") {
        return Promise.resolve({ accessGranted: true, contributionCount: 0 });
      }
      nextCalls += 1;
      if (nextCalls === 1) {
        return Promise.resolve({ scenario, contributionCount: 0 });
      }
      if (nextCalls === 2) {
        return Promise.reject(new Error("next unavailable"));
      }
      return Promise.resolve({ scenario: null, contributionCount: 1 });
    });
    mocks.apiPost.mockResolvedValue({ contributionCount: 1 });

    renderAnnotation();
    await submitCurrentScenario();

    expect(
      await screen.findByText("Impossibile caricare i dati esperti"),
    ).toBeInTheDocument();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Risposta salvata.");
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));

    expect(
      await screen.findByText("Nuovi scenari in preparazione"),
    ).toBeInTheDocument();
    expect(mocks.apiPost).toHaveBeenCalledOnce();
    expect(nextCalls).toBe(3);
  });

  it("requires an explicit replacement action for a stale scenario", async () => {
    let nextCalls = 0;
    mocks.apiGet.mockImplementation((path) => {
      if (path === "/annotations/status") {
        return Promise.resolve({ accessGranted: true, contributionCount: 0 });
      }
      nextCalls += 1;
      return Promise.resolve(
        nextCalls === 1
          ? { scenario, contributionCount: 0 }
          : { scenario: null, contributionCount: 0 },
      );
    });
    mocks.apiPost.mockRejectedValue(
      new ApiError(409, "Scenario identity is stale"),
    );

    renderAnnotation();
    await submitCurrentScenario();

    const replacement = await screen.findByRole("button", {
      name: "Carica un altro scenario",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Questo scenario non è più disponibile.",
    );
    expect(mocks.apiPost).toHaveBeenCalledOnce();
    expect(nextCalls).toBe(1);

    fireEvent.click(replacement);

    expect(
      await screen.findByText("Nuovi scenari in preparazione"),
    ).toBeInTheDocument();
    expect(mocks.apiPost).toHaveBeenCalledOnce();
    expect(nextCalls).toBe(2);
  });

  it("retries a failed initial load", async () => {
    mocks.apiGet
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ accessGranted: true, contributionCount: 2 })
      .mockResolvedValueOnce({ scenario: null, contributionCount: 2 });

    renderAnnotation();
    expect(
      await screen.findByText("Impossibile caricare i dati esperti"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }));

    expect(
      await screen.findByText("Nuovi scenari in preparazione"),
    ).toBeInTheDocument();
  });
});
