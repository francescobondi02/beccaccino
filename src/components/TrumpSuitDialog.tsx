import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type TrumpSuitDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectSuit: (suit: string) => void;
};

const italianSuits = [
  { name: "Coins", value: "coins", icon: "🪙" },
  { name: "Cups", value: "cups", icon: "🏆" },
  { name: "Swords", value: "swords", icon: "⚔️" },
  { name: "Clubs", value: "clubs", icon: "🏏" },
];

const TrumpSuitDialog = ({ open, onOpenChange, onSelectSuit }: TrumpSuitDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center">Choose Trump Suit</DialogTitle>
          <DialogDescription className="text-center">
            Select the suit that will be trump for this game
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid grid-cols-2 gap-4 mt-4">
          {italianSuits.map((suit) => (
            <Button
              key={suit.value}
              variant="outline"
              size="lg"
              className="h-24 flex flex-col gap-2 hover:bg-primary/10 hover:border-primary transition-all"
              onClick={() => onSelectSuit(suit.value)}
            >
              <span className="text-4xl">{suit.icon}</span>
              <span className="text-sm font-semibold">{suit.name}</span>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TrumpSuitDialog;
