import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import PlayingCard from "./PlayingCard";

type LastTrickDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const LastTrickDialog = ({ open, onOpenChange }: LastTrickDialogProps) => {
  // Mock data for the last trick (4 cards)
  const lastTrick = [
    { id: "1", suit: "coins", value: 7, player: "You" },
    { id: "2", suit: "cups", value: 3, player: "Teammate" },
    { id: "3", suit: "swords", value: 5, player: "Opponent 1" },
    { id: "4", suit: "clubs", value: 2, player: "Opponent 2" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center">Last Trick</DialogTitle>
          <DialogDescription className="text-center">
            The cards played in the previous round
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid grid-cols-4 gap-4 mt-4 justify-items-center">
          {lastTrick.map((card) => (
            <div key={card.id} className="flex flex-col items-center gap-2">
              <PlayingCard suit={card.suit} value={card.value} size="md" />
              <span className="text-xs text-muted-foreground font-medium">{card.player}</span>
            </div>
          ))}
        </div>

        {lastTrick.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No tricks played yet
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default LastTrickDialog;
