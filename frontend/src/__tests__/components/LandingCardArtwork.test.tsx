import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LandingCardArtwork from "@/components/lobby/LandingCardArtwork";
import ArcadeHero from "@/components/lobby/ArcadeHero";
import PlayingCard from "@/components/PlayingCard";

describe("LandingCardArtwork", () => {
  it("draws the five landing illustrations without raster content or poker indices", () => {
    const cards = ["asso_denari", "tre_spade", "re_coppe", "cavallo_bastoni", "due_denari"] as const;
    const { container } = render(
      <>{cards.map((card) => <LandingCardArtwork key={card} card={card} />)}</>,
    );

    expect(screen.getAllByRole("img")).toHaveLength(5);
    expect(container.querySelector("img, image, text")).toBeNull();
    for (const card of cards) {
      const [value, suit] = card.split("_");
      expect(screen.getByRole("img", { name: `${value} di ${suit}` }).querySelector("path")).not.toBeNull();
    }
  });

  it("keeps decorative SVGs in the hero and original artwork in playable cards", () => {
    const onPlay = vi.fn();
    const { container } = render(
      <>
        <ArcadeHero onPlay={vi.fn()} onRules={vi.fn()} motionStopped />
        <PlayingCard suit="denara" value="tre" onClick={onPlay} clickable />
      </>,
    );

    expect(container.querySelectorAll(".club-fan svg[data-landing-card]")).toHaveLength(5);
    const card = screen.getByRole("button", { name: "Gioca tre di denari" });
    expect(within(card).getByAltText("tre di denari")).toHaveAttribute("src", "/images/cards/tre_denari.png");
    expect(card.querySelector("svg")).toBeNull();
    fireEvent.click(card);
    expect(onPlay).toHaveBeenCalledOnce();
  });
});
