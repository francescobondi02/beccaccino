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
  practiceActions?: ReactNode;
  inline?: boolean;
  disabled?: boolean;
};

const italianSuits = [
  { name: "Denari", value: "denara", img: "/images/semi/denara_seme.png" },
  { name: "Coppe", value: "coppe", img: "/images/semi/coppe_seme.png" },
  { name: "Spade", value: "spade", img: "/images/semi/spade_seme.png" },
  { name: "Bastoni", value: "bastoni", img: "/images/semi/bastoni_seme.png" },
];

const TrumpSuitDialog = ({
  open,
  onSelectSuit,
  myCards,
  practiceActions,
  inline = false,
  disabled = false,
}: Omit<TrumpSuitDialogProps, "onOpenChange">) => {
  if (inline) {
    return open ? (
      <section className="mobile-lab-choose" aria-labelledby="mobile-trump-title">
        <header><span>Tocca a te</span><h2 id="mobile-trump-title">Scegli la briscola.</h2></header>
        <p>Tocca un seme per iniziare la presa.</p>
        <div className="mobile-lab-suits" role="group" aria-label="Scegli il seme di briscola">
          {italianSuits.map((suit) => (
            <button key={suit.value} disabled={disabled} onClick={() => onSelectSuit(suit.value)} data-testid={`suit-button-${suit.value}`}>
              <img src={suit.img} alt="" />{suit.name}
            </button>
          ))}
        </div>
      </section>
    ) : null;
  }

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="arcade-trump-dialog sm:max-w-4xl max-h-[90vh] overflow-y-auto border-[hsl(39_45%_50%_/_0.7)] bg-card shadow-2xl [&>button]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center">
            Scegli la briscola
          </DialogTitle>
          <DialogDescription className="text-center">
            Osserva la tua mano e seleziona il seme che sarà la briscola per
            questa smazzata.
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {italianSuits.map((suit) => (
              <Button
                key={suit.value}
                variant="outline"
                size="lg"
                className="h-24 flex flex-col gap-2 border-border/80 bg-secondary/35 hover:border-accent hover:bg-accent/10 hover:text-foreground transition-[transform,border-color,background-color] hover:-translate-y-0.5"
                onClick={() => onSelectSuit(suit.value)}
                disabled={disabled}
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

        {practiceActions && (
          <div className="border-t border-border pt-4">{practiceActions}</div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default TrumpSuitDialog;
