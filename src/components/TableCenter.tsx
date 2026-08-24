import PlayingCard from "@/components/PlayingCard";
import type { PlayerPosition } from "@/game/model";

interface PlacedCard {
  userId: number;
  suit: string;
  value: string;
  position: PlayerPosition;
}

interface TableCenterProps {
  cards: PlacedCard[];
  briscolaChosen: boolean;
  waitingForUsername: string;
  countdown: number | null;
}

const ANIMATION_CLASS: Record<PlayerPosition, string> = {
  bottom: "animate-card-from-bottom",
  top: "animate-card-from-top",
  left: "animate-card-from-left",
  right: "animate-card-from-right",
};

// Cards land near center, nudged toward the side of the player who played them.
const PLACEMENT_CLASS: Record<PlayerPosition, string> = {
  bottom: "top-1/2 left-1/2 -translate-x-1/2 translate-y-2",
  top: "top-1/2 left-1/2 -translate-x-1/2 -translate-y-full",
  left: "top-1/2 left-1/2 -translate-y-1/2 -translate-x-full",
  right: "top-1/2 left-1/2 -translate-y-1/2 translate-x-2",
};

const TableCenter = ({
  cards,
  briscolaChosen,
  waitingForUsername,
  countdown,
}: TableCenterProps) => (
  <div
    className="relative w-80 h-80 rounded-full bg-gradient-to-br from-primary/5 to-accent/5 border-4 border-primary/20 shadow-2xl flex items-center justify-center"
    data-testid="game-table-center"
  >
    {cards.length > 0 ? (
      cards.map((card) => (
        <div
          key={`${card.userId}-${card.suit}-${card.value}`}
          className={`absolute ${ANIMATION_CLASS[card.position]} ${PLACEMENT_CLASS[card.position]}`}
        >
          <PlayingCard suit={card.suit} value={card.value} size="md" />
        </div>
      ))
    ) : (
      <div className="text-center">
        <p className="text-muted-foreground text-sm">
          {briscolaChosen
            ? `In attesa di ${waitingForUsername}...`
            : "In attesa che venga scelta la briscola..."}
        </p>
        {countdown !== null && (
          <div
            className={`mt-2 text-2xl font-bold ${countdown <= 10 ? "text-destructive animate-pulse" : "text-primary"}`}
          >
            {countdown}s
          </div>
        )}
      </div>
    )}
  </div>
);

export default TableCenter;
