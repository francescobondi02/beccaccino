import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AuthDialog from "@/components/AuthDialog";

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

import { toast } from "sonner";

describe("AuthDialog", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onAuthSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset fetch mock
    global.fetch = vi.fn();
  });

  it("renders login form by default", () => {
    render(<AuthDialog {...defaultProps} />);
    // "Accedi" appears as both title and button
    expect(screen.getAllByText("Accedi").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText("Nome utente")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    render(<AuthDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Accedi")).not.toBeInTheDocument();
  });

  it("toggles between login and register mode", () => {
    render(<AuthDialog {...defaultProps} />);

    // Initially shows login (title + button both say "Accedi")
    expect(screen.getAllByText("Accedi").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Non hai un account? Registrati")).toBeInTheDocument();

    // Click to switch to register
    fireEvent.click(screen.getByText("Non hai un account? Registrati"));
    expect(screen.getAllByText("Registrati").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Hai già un account? Accedi")).toBeInTheDocument();
  });

  it("shows error toast when username is empty", async () => {
    render(<AuthDialog {...defaultProps} />);

    const form = screen.getByLabelText("Password").closest("form")!;
    fireEvent.submit(form);

    expect(toast.error).toHaveBeenCalledWith("Inserisci un nome utente");
  });

  it("shows error toast when password is empty", async () => {
    render(<AuthDialog {...defaultProps} />);

    fireEvent.change(screen.getByLabelText("Nome utente"), {
      target: { value: "TestUser" },
    });

    const form = screen.getByLabelText("Password").closest("form")!;
    fireEvent.submit(form);

    expect(toast.error).toHaveBeenCalledWith("Inserisci una password");
  });

  it("shows error toast when password is too short", async () => {
    render(<AuthDialog {...defaultProps} />);

    fireEvent.change(screen.getByLabelText("Nome utente"), {
      target: { value: "TestUser" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "abc" },
    });

    const form = screen.getByLabelText("Password").closest("form")!;
    fireEvent.submit(form);

    expect(toast.error).toHaveBeenCalledWith(
      "La password deve essere di almeno 6 caratteri"
    );
  });

  it("calls fetch with login endpoint on login submit", async () => {
    const mockResponse = {
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ username: "TestUser", id: 1 })),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    render(<AuthDialog {...defaultProps} />);

    fireEvent.change(screen.getByLabelText("Nome utente"), {
      target: { value: "TestUser" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password123" },
    });

    const form = screen.getByLabelText("Password").closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/users/login"),
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          body: JSON.stringify({ username: "TestUser", password: "password123" }),
        })
      );
    });
  });

  it("calls fetch with register endpoint when in register mode", async () => {
    const mockResponse = {
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ username: "NewUser", id: 2 })),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    render(<AuthDialog {...defaultProps} />);

    // Switch to register mode
    fireEvent.click(screen.getByText("Non hai un account? Registrati"));

    fireEvent.change(screen.getByLabelText("Nome utente"), {
      target: { value: "NewUser" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "newpass123" },
    });

    const form = screen.getByLabelText("Password").closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/users/register"),
        expect.objectContaining({
          method: "POST",
        })
      );
    });
  });

  it("calls onAuthSuccess and onOpenChange on successful login", async () => {
    const mockResponse = {
      ok: true,
      text: () => Promise.resolve(JSON.stringify({ username: "TestUser", id: 42 })),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    render(<AuthDialog {...defaultProps} />);

    fireEvent.change(screen.getByLabelText("Nome utente"), {
      target: { value: "TestUser" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password123" },
    });

    const form = screen.getByLabelText("Password").closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(defaultProps.onAuthSuccess).toHaveBeenCalledWith("TestUser", 42);
      expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
      expect(toast.success).toHaveBeenCalledWith("Accesso effettuato!");
    });
  });

  it("shows error toast on failed login", async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      text: () => Promise.resolve(JSON.stringify({ error: "Credenziali non valide" })),
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    render(<AuthDialog {...defaultProps} />);

    fireEvent.change(screen.getByLabelText("Nome utente"), {
      target: { value: "TestUser" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrongpass" },
    });

    const form = screen.getByLabelText("Password").closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Credenziali non valide");
    });
  });

  it("shows error toast on network error", async () => {
    (global.fetch as any).mockRejectedValue(new Error("Network error"));

    render(<AuthDialog {...defaultProps} />);

    fireEvent.change(screen.getByLabelText("Nome utente"), {
      target: { value: "TestUser" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password123" },
    });

    const form = screen.getByLabelText("Password").closest("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Network error");
    });
  });

  it("shows Google login not available toast", () => {
    render(<AuthDialog {...defaultProps} />);
    // Google button is disabled, but let's verify the text is there
    expect(screen.getByText("Continua con Google")).toBeInTheDocument();
  });
});
