import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import PlayingCard from "./PlayingCard";

interface PlayedCardData {
  playerId: number;
  userId: number;
  suit: string;
  value: string;
  position: number;
}

interface Player {
  id: number;
  userId: number;
  username: string;
  seat: number | null;
  team: number | null;
  isReady: boolean;
}

type LastTrickDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lastHand: PlayedCardData[];
  players: Player[];
  userId: number | null;
};

const LastTrickDialog = ({
  open,
  onOpenChange,
  lastHand,
  players,
  userId,
}: LastTrickDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center">
            Ultima Mano
          </DialogTitle>
          <DialogDescription className="text-center">
            Le carte giocate nella mano precedente
          </DialogDescription>
        </DialogHeader>

        {lastHand.length > 0 ? (
          <div className="grid grid-cols-4 gap-4 mt-4 justify-items-center">
            {lastHand.map((card, idx) => {
              const player = players.find((p) => p.userId === card.userId);
              const playerName =
                card.userId === userId
                  ? "Tu"
                  : player?.username || "Sconosciuto";

              return (
                <div key={idx} className="flex flex-col items-center gap-2">
                  <PlayingCard suit={card.suit} value={card.value} size="md" />
                  <span className="text-xs text-muted-foreground font-medium">
                    {playerName}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            Nessuna mano completata ancora.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default LastTrickDialog;
