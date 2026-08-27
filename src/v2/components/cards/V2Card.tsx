import { cardSrc } from "./cardAssets";
import { cn } from "@/v2/lib/cn";

interface V2CardProps {
  /** File name such as "asso_denari.png". */
  filename: string;
  /** Accessible name; empty string marks the card as decorative. */
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  tilt?: boolean;
}

/** Static presentational card image. Interactive cards wrap this in a button. */
const V2Card = ({ filename, alt = "", className, style, tilt }: V2CardProps) => (
  <img
    src={cardSrc(filename)}
    alt={alt}
    aria-hidden={alt === "" ? true : undefined}
    loading="lazy"
    draggable={false}
    className={cn(
      "select-none rounded-lg shadow-[var(--becca-shadow-card)] ring-1 ring-[hsl(170_40%_6%/0.25)]",
      tilt && "becca-tilt",
      className,
    )}
    style={style}
  />
);

export default V2Card;
