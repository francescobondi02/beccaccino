import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
    const img = screen.getByAltText("tre di denara");
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
  });

  it("does not fire onClick when disabled", () => {
    const onClick = vi.fn();
    const { container } = render(
      <PlayingCard onClick={onClick} clickable={true} disabled={true} />
    );
    fireEvent.click(container.firstElementChild!);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("applies disabled styles", () => {
    const { container } = render(<PlayingCard disabled={true} />);
    expect(container.firstElementChild).toHaveClass("opacity-40", "grayscale");
  });

  it("applies custom className", () => {
    const { container } = render(<PlayingCard className="my-custom-class" />);
    expect(container.firstElementChild).toHaveClass("my-custom-class");
  });
});
