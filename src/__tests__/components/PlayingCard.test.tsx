import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import PlayingCard from "@/components/PlayingCard";

describe("PlayingCard", () => {
  it("renders with correct image src", () => {
    render(<PlayingCard suit="coppe" value="asso" />);
    const img = screen.getByAltText("asso di coppe");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "/images/cards/asso_coppe.png");
  });

  it("maps denara suit to denari for the image filename", () => {
    render(<PlayingCard suit="denara" value="tre" />);
    const img = screen.getByAltText("tre di denari");
    expect(img).toHaveAttribute("src", "/images/cards/tre_denari.png");
  });

  it("applies size classes correctly", () => {
    const { container: sm } = render(<PlayingCard size="sm" />);
    expect(sm.firstElementChild).toHaveClass("w-12", "h-16");

    const { container: lg } = render(<PlayingCard size="lg" />);
    expect(lg.firstElementChild).toHaveClass("w-20", "h-28");
  });

  it("is not clickable by default", () => {
    const onClick = vi.fn();
    const { container } = render(<PlayingCard onClick={onClick} />);
    fireEvent.click(container.firstElementChild!);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("fires onClick when clickable", () => {
    const onClick = vi.fn();
    const { container } = render(
      <PlayingCard onClick={onClick} clickable={true} />
    );
    fireEvent.click(container.firstElementChild!);
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Gioca asso di bastoni" })).toBeEnabled();
  });

  it("does not fire onClick when disabled", () => {
    const onClick = vi.fn();
    const { container } = render(
      <PlayingCard onClick={onClick} clickable={true} disabled={true} />
    );
    fireEvent.click(container.firstElementChild!);
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Gioca asso di bastoni" })).toBeDisabled();
  });

  it("applies disabled styles", () => {
    const { container } = render(<PlayingCard disabled={true} />);
    expect(container.firstElementChild).toHaveClass("opacity-40", "grayscale");
  });

  it("applies custom className", () => {
    const { container } = render(<PlayingCard className="my-custom-class" />);
    expect(container.firstElementChild).toHaveClass("my-custom-class");
  });

  describe("fallback placeholder", () => {
    it("shows fallback with suit symbol when image fails to load", () => {
      render(<PlayingCard suit="denara" value="asso" />);
      const img = screen.getByAltText("asso di denari");

      // Simulate image load failure
      act(() => {
        fireEvent.error(img);
      });

      // Image should be gone, fallback should show
      expect(screen.queryByAltText("asso di denari")).not.toBeInTheDocument();

      // Fallback should show the suit symbol
      expect(screen.getByText("♦")).toBeInTheDocument();
      // Fallback should show the card value
      expect(screen.getByText("asso")).toBeInTheDocument();
    });

    it("shows correct symbol for each suit in fallback", () => {
      const suitMap = [
        { suit: "denara", symbol: "♦" },
        { suit: "coppe", symbol: "♥" },
        { suit: "spade", symbol: "♠" },
        { suit: "bastoni", symbol: "♣" },
      ];

      for (const { suit, symbol } of suitMap) {
        const { unmount } = render(<PlayingCard suit={suit} value="re" />);
        const img = screen.getByAltText(`re di ${suit === "denara" ? "denari" : suit}`);

        act(() => {
          fireEvent.error(img);
        });

        expect(screen.getByText(symbol)).toBeInTheDocument();
        unmount();
      }
    });

    it("resets fallback when suit/value props change", () => {
      const { rerender } = render(<PlayingCard suit="coppe" value="asso" />);
      const img = screen.getByAltText("asso di coppe");

      // Trigger error
      act(() => {
        fireEvent.error(img);
      });

      // Fallback should be visible
      expect(screen.queryByAltText("asso di coppe")).not.toBeInTheDocument();
      expect(screen.getByText("♥")).toBeInTheDocument();

      // Change props — should reset to showing the image again
      rerender(<PlayingCard suit="spade" value="re" />);

      // Should render new image (not fallback)
      const newImg = screen.getByAltText("re di spade");
      expect(newImg).toBeInTheDocument();
      expect(newImg).toHaveAttribute("src", "/images/cards/re_spade.png");
    });
  });
});
