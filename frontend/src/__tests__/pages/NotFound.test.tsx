import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NotFound from "@/pages/NotFound";

function renderNotFound() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["auth", "current-user"], null);
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><NotFound /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("NotFound page", () => {
  it("renders 404 heading", () => {
    renderNotFound();
    expect(screen.getByText("404")).toBeInTheDocument();
  });

  it("renders descriptive message", () => {
    renderNotFound();
    expect(screen.getByText("Qui non ci sono carte da giocare.")).toBeInTheDocument();
  });

  it("has a link back to home", () => {
    renderNotFound();
    const link = screen.getByRole("link", { name: "Torna alla home" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/");
  });
});
