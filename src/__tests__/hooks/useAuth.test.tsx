import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
}));

const apiGet = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, apiGet: (path: string) => apiGet(path) };
});

function Probe() {
  useAuth({ redirectOnFail: true });
  return null;
}

describe("useAuth redirectOnFail", () => {
  beforeEach(() => {
    navigate.mockClear();
    apiGet.mockReset();
  });

  it("redirects home on a 500 response", async () => {
    apiGet.mockRejectedValue(new ApiError(500, "Server error"));
    render(<Probe />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
  });

  it("redirects home on a network error (non-ApiError)", async () => {
    apiGet.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<Probe />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
  });

  it("does not redirect when the check succeeds", async () => {
    apiGet.mockResolvedValue({ id: 1, username: "alice" });
    render(<Probe />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });
});
