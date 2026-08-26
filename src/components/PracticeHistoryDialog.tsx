import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import PlayingCard from "@/components/PlayingCard";
import TrickHistoryDialog, {
  type HistoryTrick,
} from "@/components/TrickHistoryDialog";
import type { MoveLogEntry, RevealedHand } from "@/game/model";
import { Eye, EyeOff } from "lucide-react";

type PracticeHistoryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  moveLog: MoveLogEntry[];
  hands: RevealedHand[] | null;
  handsRevealed: boolean;
  onToggleHands: () => void;
  usernameOf: (userId: number) => string;
};

const groupMoves = (moves: MoveLogEntry[]): HistoryTrick[] => {
  const tricks: HistoryTrick[] = [];
  for (const move of moves) {
    let trick = tricks[tricks.length - 1];
    if (!trick || trick.number !== move.handNumber) {
      trick = { number: move.handNumber, plays: [] };
      tricks.push(trick);
    }
    trick.plays.push({
      label: move.username,
      suit: move.suit,
      value: move.value,
      signal: move.signal,
    });
  }
  return tricks;
};

const PracticeHistoryDialog = ({
  open,
  onOpenChange,
  moveLog,
  hands,
  handsRevealed,
  onToggleHands,
  usernameOf,
}: PracticeHistoryDialogProps) => (
  <TrickHistoryDialog
    open={open}
    onOpenChange={onOpenChange}
    title="Storico pratica"
    description="Carte giocate e segnali, mano per mano"
    tricks={groupMoves(moveLog)}
    testId="practice-history"
    actions={
      hands ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onToggleHands}
          aria-pressed={handsRevealed}
          data-testid="toggle-reveal-hands"
        >
          {handsRevealed ? (
            <EyeOff className="mr-2 h-4 w-4" />
          ) : (
            <Eye className="mr-2 h-4 w-4" />
          )}
          {handsRevealed ? "Nascondi mani" : "Mostra mani"}
        </Button>
      ) : undefined
    }
  >
    {hands && handsRevealed && (
      <section className="mt-8 space-y-4 border-t border-border pt-6">
        <h3 className="text-lg font-semibold">Mani scoperte</h3>
        <div className="grid gap-6 lg:grid-cols-2">
          {hands.map((hand) => (
            <div key={hand.userId} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {usernameOf(hand.userId)}
                </span>
                {hand.botModel && (
                  <Badge variant="outline">{hand.botModel}</Badge>
                )}
              </div>
              {hand.cards.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nessuna carta</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {hand.cards.map((card) => (
                    <PlayingCard
                      key={`${card.suit}-${card.value}`}
                      suit={card.suit}
                      value={card.value}
                      size="sm"
                      className="rounded-sm"
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    )}
  </TrickHistoryDialog>
);

export default PracticeHistoryDialog;
