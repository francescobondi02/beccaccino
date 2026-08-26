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
  bottom: "animate-table-card-from-bottom",
  top: "animate-table-card-from-top",
  left: "animate-table-card-from-left",
  right: "animate-table-card-from-right",
};

// Cards land near center, nudged toward the side of the player who played them.
const PLACEMENT_CLASS: Record<PlayerPosition, string> = {
  bottom:
    "bottom-10 [@media(max-height:800px)]:bottom-6 left-1/2 -translate-x-1/2",
  top: "top-10 [@media(max-height:800px)]:top-6 left-1/2 -translate-x-1/2",
  left:
    "top-1/2 left-8 [@media(max-height:800px)]:left-4 -translate-y-1/2",
  right:
    "top-1/2 right-8 [@media(max-height:800px)]:right-4 -translate-y-1/2",
};

const TableCenter = ({
  cards,
  briscolaChosen,
  waitingForUsername,
  countdown,
}: TableCenterProps) => (
  <div
    className="relative w-[25rem] h-[25rem] [@media(max-height:800px)]:w-72 [@media(max-height:800px)]:h-72 [@media(max-height:800px)]:translate-y-6 rounded-full bg-gradient-to-br from-primary/5 to-accent/5 border-4 border-primary/20 shadow-2xl flex items-center justify-center"
    data-testid="game-table-center"
  >
    {cards.length > 0 ? (
      cards.map((card) => (
        <div
          key={`${card.userId}-${card.suit}-${card.value}`}
          className={`absolute ${PLACEMENT_CLASS[card.position]}`}
          data-testid={`table-card-position-${card.position}`}
        >
          <div className={ANIMATION_CLASS[card.position]}>
            <PlayingCard
              suit={card.suit}
              value={card.value}
              size="md"
              className="xl:w-20 xl:h-28"
            />
          </div>
        </div>
      ))
    ) : (
      <div className="text-center">
        <p className="text-muted-foreground text-sm">
          {briscolaChosen
            ? `In attesa di ${waitingForUsername}...`
            : `${waitingForUsername} sta selezionando la briscola...`}
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
