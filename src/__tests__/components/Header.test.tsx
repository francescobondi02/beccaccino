import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Header from "@/components/Header";

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function renderHeader(props: { username?: string; onLogout?: () => void }) {
  return render(
    <MemoryRouter>
      <Header {...props} />
    </MemoryRouter>
  );
}

describe("Header", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the brand title", () => {
    renderHeader({});
    expect(screen.getByText(/beccaccino/i)).toBeInTheDocument();
  });

  it("navigates to home when clicking the brand title", () => {
    renderHeader({});
    fireEvent.click(screen.getByText(/beccaccino/i));
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });

  it("shows user avatar when username is provided", () => {
    renderHeader({ username: "Francesco" });
    // Single word username → first letter only (getInitials slices to 2 max)
    expect(screen.getByText("F")).toBeInTheDocument();
  });

  it("shows single initial for single-name username", () => {
    renderHeader({ username: "Mario" });
    expect(screen.getByText("M")).toBeInTheDocument();
  });

  it("shows two initials for two-word username", () => {
    renderHeader({ username: "Mario Rossi" });
    expect(screen.getByText("MR")).toBeInTheDocument();
  });

  it("does not show avatar when no username", () => {
    renderHeader({});
    // No trigger button with avatar should be present
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows username text on larger screens", () => {
    renderHeader({ username: "TestPlayer" });
    expect(screen.getByText("TestPlayer")).toBeInTheDocument();
  });
});
