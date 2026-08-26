import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import PlayingCard from "./PlayingCard";
import type { PlayerCard } from "@/game/model";

type TrumpSuitDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectSuit: (suit: string) => void;
  myCards: PlayerCard[];
  practiceLeaveAction?: ReactNode;
};

const italianSuits = [
  { name: "Denara", value: "denara", img: "/images/semi/denara_seme.png" },
  { name: "Coppe", value: "coppe", img: "/images/semi/coppe_seme.png" },
  { name: "Spade", value: "spade", img: "/images/semi/spade_seme.png" },
  { name: "Bastoni", value: "bastoni", img: "/images/semi/bastoni_seme.png" },
];

const TrumpSuitDialog = ({
  open,
  onSelectSuit,
  myCards,
  practiceLeaveAction,
}: Omit<TrumpSuitDialogProps, "onOpenChange">) => {
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-4xl max-h-[90vh] overflow-y-auto"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center">
            Scegli la briscola
          </DialogTitle>
          <DialogDescription className="text-center">
            Osserva la tua mano e seleziona il seme che sarà la briscola per
            questo round
          </DialogDescription>
        </DialogHeader>

        {/* Carte in mano */}
        <div className="my-6">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3 text-center">
            La tua mano
          </h3>
          <div className="flex gap-2 flex-wrap justify-center max-w-3xl mx-auto">
            {myCards
              .filter((c) => c.inHand)
              .map((card) => (
                <PlayingCard
                  key={card.id}
                  suit={card.suit}
                  value={card.value}
                  size="sm"
                />
              ))}
          </div>
        </div>

        {/* Selezione briscola */}
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-3 text-center">
            Seleziona la briscola
          </h3>
          <div className="grid grid-cols-4 gap-3">
            {italianSuits.map((suit) => (
              <Button
                key={suit.value}
                variant="outline"
                size="lg"
                className="h-24 flex flex-col gap-2 hover:bg-primary/10 hover:border-primary hover:text-foreground transition-all"
                onClick={() => onSelectSuit(suit.value)}
                data-testid={`suit-button-${suit.value}`}
              >
                <img
                  src={suit.img}
                  alt={suit.name}
                  className="w-10 h-10 object-contain"
                />
                <span className="text-sm font-semibold">{suit.name}</span>
              </Button>
            ))}
          </div>
        </div>

        {practiceLeaveAction && (
          <div className="flex justify-end">{practiceLeaveAction}</div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default TrumpSuitDialog;
