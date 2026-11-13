import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import PlayingCard from "./PlayingCard";
import type { PlayedCardData } from "@/game/model";
import type { RoomPlayer } from "@/rooms/model";

type LastTrickDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lastHand: PlayedCardData[];
  players: RoomPlayer[];
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center">
            Ultima presa
          </DialogTitle>
          <DialogDescription className="text-center">
            Le carte giocate nella presa precedente.
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
                  <span className="max-w-full break-all text-xs text-muted-foreground font-medium">
                    {playerName}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            Nessuna presa ancora completata.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default LastTrickDialog;
