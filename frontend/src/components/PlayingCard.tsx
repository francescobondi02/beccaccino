import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

type PlayingCardProps = {
  suit?: string;
  value?: string;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  clickable?: boolean;
  disabled?: boolean;
  className?: string;
  "data-testid"?: string;
  "aria-pressed"?: boolean;
};

// Mappa suit DB (denara) -> nome file immagine (denari)
const suitFileMap: Record<string, string> = {
  denara: "denari",
  coppe: "coppe",
  spade: "spade",
  bastoni: "bastoni",
};

// Mappa suit -> colore per il fallback
const suitColorMap: Record<string, string> = {
  denara: "text-yellow-500",
  coppe: "text-red-500",
  spade: "text-blue-500",
  bastoni: "text-green-500",
};

// Mappa suit -> simbolo emoji per il fallback
const suitSymbolMap: Record<string, string> = {
  denara: "♦",
  coppe: "♥",
  spade: "♠",
  bastoni: "♣",
};

const PlayingCard = ({
  suit = "bastoni",
  value = "asso",
  size = "md",
  onClick,
  clickable = false,
  disabled = false,
  className,
  "data-testid": dataTestId,
  "aria-pressed": ariaPressed,
}: PlayingCardProps) => {
  const [imgError, setImgError] = useState(false);

  // Reset error state when card identity changes (prevents stale error from reused component)
  useEffect(() => {
    setImgError(false);
  }, [suit, value]);

  const sizeClasses = {
    sm: "w-12 h-16",
    md: "w-16 h-24",
    lg: "w-20 h-28",
  };

  const suitFile = suitFileMap[suit] ?? suit;
  const imgSrc = `/images/cards/${value}_${suitFile}.png`;
  const Component = onClick ? "button" : "div";

  return (
    <Component
      type={onClick ? "button" : undefined}
      disabled={onClick ? disabled || !clickable : undefined}
      aria-label={onClick ? `Gioca ${value} di ${suitFile}` : undefined}
      aria-pressed={onClick ? ariaPressed : undefined}
      className={cn(
        "circolo-card relative overflow-hidden rounded-md border border-[hsl(39_45%_50%_/_0.52)] bg-card transition-[transform,box-shadow,border-color,opacity] duration-200",
        sizeClasses[size],
        clickable &&
          !disabled &&
          "circolo-card-playable cursor-pointer hover:-translate-y-2 hover:scale-[1.06] hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled && "opacity-40 grayscale cursor-not-allowed",
        className,
      )}
      onClick={clickable && !disabled ? onClick : undefined}
      data-testid={dataTestId ?? `card-${suit}-${value}`}
      data-playable={clickable && !disabled ? "true" : "false"}
    >
      {imgError ? (
        // Styled fallback placeholder when image fails to load
        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-secondary to-card p-1">
          <span className={cn("text-lg font-bold", suitColorMap[suit] ?? "text-foreground")}>
            {suitSymbolMap[suit] ?? "?"}
          </span>
          <span className="text-[9px] text-muted-foreground text-center leading-tight capitalize truncate w-full px-0.5">
            {value}
          </span>
        </div>
      ) : (
        <img
          src={imgSrc}
          alt={`${value} di ${suitFile}`}
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
        />
      )}
    </Component>
  );
};

export default PlayingCard;
