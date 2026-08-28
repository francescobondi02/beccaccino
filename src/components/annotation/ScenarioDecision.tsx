import { CheckCircle2, CircleHelp, MessageCircle } from "lucide-react";
import type {
  AnnotationCard,
  AnnotationScenario,
  AnnotationSuit,
} from "@/annotations/model";
import {
  actionMatchesCard,
  cardKey,
  type SignalChoice,
} from "@/annotations/presentation";
import PlayingCard from "@/components/PlayingCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const SIGNAL_OPTIONS = [
  { value: "striscio" as const, label: "Striscio" },
  { value: "busso" as const, label: "Busso" },
  { value: "volo" as const, label: "Volo" },
  { value: null, label: "Niente" },
];

const SUIT_OPTIONS: Array<{
  value: AnnotationSuit;
  label: string;
  image: string;
}> = [
  {
    value: "denara",
    label: "Denara",
    image: "/images/semi/denara_seme.png",
  },
  { value: "coppe", label: "Coppe", image: "/images/semi/coppe_seme.png" },
  { value: "spade", label: "Spade", image: "/images/semi/spade_seme.png" },
  {
    value: "bastoni",
    label: "Bastoni",
    image: "/images/semi/bastoni_seme.png",
  },
];

interface ScenarioDecisionProps {
  scenario: AnnotationScenario;
  selectedCard: AnnotationCard | null;
  selectedSuit: AnnotationSuit | null;
  signalChoice: SignalChoice;
  isLeader: boolean;
  isSubmitting: boolean;
  canConfirm: boolean;
  onCardSelect: (card: AnnotationCard) => void;
  onSuitSelect: (suit: AnnotationSuit) => void;
  onSignalSelect: (signal: SignalChoice) => void;
  onSkip: () => void;
  onConfirm: () => void;
}

export default function ScenarioDecision({
  scenario,
  selectedCard,
  selectedSuit,
  signalChoice,
  isLeader,
  isSubmitting,
  canConfirm,
  onCardSelect,
  onSuitSelect,
  onSignalSelect,
  onSkip,
  onConfirm,
}: ScenarioDecisionProps) {
  return (
    <Card className="border-border/70">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">La tua mano</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {scenario.decisionType === "play_card" ? (
          <div className="overflow-x-auto pb-3">
            <div className="flex min-w-max gap-3 px-1 pt-2">
              {scenario.hand.map((card) => {
                const legal = scenario.legalActions.some((action) =>
                  actionMatchesCard(action, card),
                );
                const selected =
                  selectedCard !== null &&
                  cardKey(selectedCard) === cardKey(card);
                return (
                  <button
                    key={cardKey(card)}
                    type="button"
                    className={cn(
                      "rounded-md p-1 outline-none ring-offset-2 transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                      selected && "bg-primary/10 ring-2 ring-primary",
                    )}
                    aria-label={`Seleziona ${card.value} di ${card.suit}`}
                    aria-pressed={selected}
                    disabled={!legal || isSubmitting}
                    onClick={() => onCardSelect(card)}
                  >
                    <PlayingCard
                      suit={card.suit}
                      value={card.value}
                      size="md"
                      disabled={!legal}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <>
            <div
              className="flex flex-wrap justify-center gap-2 px-1 pt-2 sm:gap-3"
              data-testid="annotation-briscola-hand"
            >
              {scenario.hand.map((card) => (
                <PlayingCard
                  key={cardKey(card)}
                  suit={card.suit}
                  value={card.value}
                  size="md"
                />
              ))}
            </div>
            <div
              className="space-y-3 border-t border-border pt-4"
              role="radiogroup"
              aria-label="Seleziona la briscola"
            >
              <p className="text-sm font-semibold">Scegli la briscola</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {SUIT_OPTIONS.map((suit) => {
                  const allowed = scenario.legalActions.includes(suit.value);
                  return (
                    <Button
                      key={suit.value}
                      type="button"
                      role="radio"
                      variant={
                        selectedSuit === suit.value ? "default" : "outline"
                      }
                      className="h-20 flex-col gap-1 px-2 sm:h-24"
                      disabled={!allowed || isSubmitting}
                      aria-label={`Scegli ${suit.label} come briscola`}
                      aria-checked={selectedSuit === suit.value}
                      onClick={() => onSuitSelect(suit.value)}
                    >
                      <img
                        src={suit.image}
                        alt=""
                        className="h-9 w-9 object-contain sm:h-10 sm:w-10"
                      />
                      <span>{suit.label}</span>
                    </Button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {scenario.decisionType === "play_card" &&
          isLeader &&
          selectedCard && (
            <div
              className="space-y-3"
              data-testid="annotation-signal-choice"
            >
              <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold">
                  Scegli esplicitamente il segnale
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {SIGNAL_OPTIONS.map((option) => {
                  const allowed = scenario.legalActions.some(
                    (action) =>
                      actionMatchesCard(action, selectedCard) &&
                      action.signal === option.value,
                  );
                  return (
                    <Button
                      key={option.label}
                      type="button"
                      variant={
                        signalChoice === option.value ? "default" : "outline"
                      }
                      disabled={!allowed || isSubmitting}
                      aria-pressed={signalChoice === option.value}
                      onClick={() => onSignalSelect(option.value)}
                    >
                      {option.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

        <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            className="w-full sm:w-auto"
            disabled={isSubmitting}
            onClick={onSkip}
          >
            <CircleHelp className="h-4 w-4" />
            Non sono sicuro
          </Button>
          <Button
            type="button"
            variant="gradient"
            className="w-full sm:w-auto"
            disabled={!canConfirm || isSubmitting}
            onClick={onConfirm}
          >
            <CheckCircle2 className="h-4 w-4" />
            Conferma scelta
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
