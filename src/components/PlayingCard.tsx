import { cn } from "@/lib/utils";
import italianCardImg from "@/assets/italian-card.png";

type PlayingCardProps = {
  suit?: string;
  value?: number;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  clickable?: boolean;
  className?: string;
};

const PlayingCard = ({ 
  suit = "coins", 
  value = 1, 
  size = "md", 
  onClick, 
  clickable = false,
  className 
}: PlayingCardProps) => {
  const sizeClasses = {
    sm: "w-12 h-16",
    md: "w-16 h-24",
    lg: "w-20 h-28",
  };

  return (
    <div
      className={cn(
        "relative rounded-lg overflow-hidden shadow-lg border-2 border-primary/20 bg-card transition-all duration-200",
        sizeClasses[size],
        clickable && "cursor-pointer hover:scale-110 hover:shadow-xl hover:border-primary/60 hover:-translate-y-2",
        className
      )}
      onClick={clickable ? onClick : undefined}
    >
      {/* Card image (placeholder) */}
      <img 
        src={italianCardImg} 
        alt={`${value} of ${suit}`}
        className="w-full h-full object-cover"
      />
      
      {/* Card label overlay (for debugging/clarity) */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent flex items-end justify-center pb-1">
        <span className="text-white text-xs font-bold drop-shadow-lg">
          {value}
        </span>
      </div>
    </div>
  );
};

export default PlayingCard;
