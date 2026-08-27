import { useMemo } from "react";
import V2Card from "./V2Card";
import { pickCards } from "./cardAssets";
import { useReducedMotion } from "@/v2/hooks/useReducedMotion";

interface ColumnProps {
  side: "left" | "right";
}

const Column = ({ side }: ColumnProps) => {
  const cards = useMemo(() => pickCards(9, side === "left" ? 0 : 5), [side]);
  const trackClass =
    side === "left" ? "becca-ambient-track" : "becca-ambient-track-reverse";

  return (
    <div
      className={`pointer-events-none absolute top-0 bottom-0 w-[136px] overflow-hidden ${
        side === "left" ? "left-0" : "right-0"
      }`}
      aria-hidden="true"
    >
      <div className={`flex flex-col gap-6 py-6 ${trackClass}`}>
        {[...cards, ...cards].map((card, i) => (
          <V2Card
            key={`${side}-${i}`}
            filename={card}
            className="mx-auto w-24 opacity-70"
            style={{ transform: `rotate(${((i % 3) - 1) * 5}deg)` }}
          />
        ))}
      </div>
    </div>
  );
};

/**
 * Decorative deck drifting on both edges of the felt. Hidden below 1024px so it
 * can never compete with the central actions on small screens.
 */
const AmbientCards = () => {
  const reduced = useReducedMotion();

  return (
    <div
      className="pointer-events-none absolute inset-0 hidden overflow-hidden lg:block"
      aria-hidden="true"
    >
      <Column side="left" />
      <Column side="right" />
      {!reduced && (
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,hsl(var(--becca-felt-deep)/0.85)_82%)]" />
      )}
    </div>
  );
};

export default AmbientCards;
