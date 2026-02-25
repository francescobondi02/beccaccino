import { cn } from "@/lib/utils";

type PlayingCardProps = {
  suit?: string;
  value?: string;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  clickable?: boolean;
  disabled?: boolean;
  className?: string;
};

// Mappa suit DB (denara) -> nome file immagine (denari)
const suitFileMap: Record<string, string> = {
  denara: "denari",
  coppe: "coppe",
  spade: "spade",
  bastoni: "bastoni",
};

const PlayingCard = ({
  suit = "bastoni",
  value = "asso",
  size = "md",
  onClick,
  clickable = false,
  disabled = false,
  className,
}: PlayingCardProps) => {
  const sizeClasses = {
    sm: "w-12 h-16",
    md: "w-16 h-24",
    lg: "w-20 h-28",
  };

  const suitFile = suitFileMap[suit] ?? suit;
  const imgSrc = `/images/cards/${value}_${suitFile}.png`;

  return (
    <div
      className={cn(
        "relative rounded-lg overflow-hidden shadow-lg border-2 border-primary/20 bg-card transition-all duration-200",
        sizeClasses[size],
        clickable &&
          !disabled &&
          "cursor-pointer hover:scale-110 hover:shadow-xl hover:border-primary/60 hover:-translate-y-2",
        disabled && "opacity-40 grayscale cursor-not-allowed",
        className,
      )}
      onClick={clickable && !disabled ? onClick : undefined}
    >
      <img
        src={imgSrc}
        alt={`${value} di ${suit}`}
        className="w-full h-full object-cover"
        onError={(e) => {
          // Fallback se l'immagine non esiste
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    </div>
  );
};

export default PlayingCard;
