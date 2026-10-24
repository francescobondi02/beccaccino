import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Header from "@/components/Header";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  theme: "arcade",
  setTheme: vi.fn(),
  auth: {
    user: null as { id: number; username: string } | null,
    logout: vi.fn(),
  },
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: mocks.theme, setTheme: mocks.setTheme }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mocks.auth,
}));
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function renderHeader(username?: string) {
  mocks.auth.user = username ? { id: 1, username } : null;
  return render(
    <MemoryRouter>
      <Header />
    </MemoryRouter>,
  );
}

describe("Header", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.user = null;
    mocks.theme = "arcade";
  });

  it("renders the brand title", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: "Beccaccino, torna alla lobby" })).toHaveTextContent("BECCA");
  });

  it("navigates to home when clicking the brand title", () => {
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Beccaccino, torna alla lobby" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });

  it("shows user avatar when authenticated", () => {
    renderHeader("Francesco");
    expect(screen.getByText("F")).toBeInTheDocument();
  });

  it("shows single initial for a single-name username", () => {
    renderHeader("Mario");
    expect(screen.getByText("M")).toBeInTheDocument();
  });

  it("shows two initials for a two-word username", () => {
    renderHeader("Mario Rossi");
    expect(screen.getByText("MR")).toBeInTheDocument();
  });

  it("does not show an avatar when anonymous", () => {
    renderHeader();
    expect(screen.queryByRole("button", { name: "Menu account" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accedi" })).toBeInTheDocument();
  });

  it("shows the shared username", () => {
    renderHeader("TestPlayer");
    expect(screen.getByText("TestPlayer")).toBeInTheDocument();
  });

  it("opens expert data from the account menu", async () => {
    renderHeader("TestPlayer");

    fireEvent.keyDown(screen.getByRole("button", { name: "Menu account" }), { key: "Enter" });
    fireEvent.click(await screen.findByText("Dati esperti"));

    expect(mocks.navigate).toHaveBeenCalledWith("/annotate");
  });

  it("keeps the classic interface available to anonymous users", () => {
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Usa interfaccia classica" }));
    expect(mocks.setTheme).toHaveBeenCalledWith("classic");
  });

  it("renders the retained classic header and can restore the new interface", () => {
    mocks.theme = "classic";
    renderHeader();
    expect(screen.getByText("Beccaccino")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Usa nuova interfaccia" }));
    expect(mocks.setTheme).toHaveBeenCalledWith("arcade");
  });
});
