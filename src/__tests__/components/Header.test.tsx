import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Header from "@/components/Header";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  auth: {
    user: null as { id: number; username: string } | null,
    logout: vi.fn(),
  },
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
  });

  it("renders the brand title", () => {
    renderHeader();
    expect(screen.getByText(/beccaccino/i)).toBeInTheDocument();
  });

  it("navigates to home when clicking the brand title", () => {
    renderHeader();
    fireEvent.click(screen.getByText(/beccaccino/i));
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
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the shared username", () => {
    renderHeader("TestPlayer");
    expect(screen.getByText("TestPlayer")).toBeInTheDocument();
  });
});
