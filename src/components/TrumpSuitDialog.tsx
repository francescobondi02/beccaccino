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
  { name: "Denara", value: "denara", icon: "🪙" },
  { name: "Coppe", value: "coppe", icon: "🏆" },
  { name: "Spade", value: "spade", icon: "⚔️" },
  { name: "Bastoni", value: "bastoni", icon: "🏏" },
];

const TrumpSuitDialog = ({
  open,
  onSelectSuit,
}: Omit<TrumpSuitDialogProps, "onOpenChange">) => {
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center">
            Scegli la briscola
          </DialogTitle>
          <DialogDescription className="text-center">
            Seleziona il seme che sarà la briscola per questa mano
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
