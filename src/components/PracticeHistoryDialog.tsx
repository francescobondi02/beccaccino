import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import PlayingCard from "@/components/PlayingCard";
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

type Trick = {
  handNumber: number | null;
  moves: MoveLogEntry[];
};

const SIGNAL_STYLES: Record<string, string> = {
  busso: "bg-red-500/15 text-red-400 border-red-500/30",
  striscio: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  volo: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};

const groupMoves = (moves: MoveLogEntry[]): Trick[] => {
  const tricks: Trick[] = [];

  for (const move of moves) {
    let trick = tricks.at(-1);
    if (!trick || trick.handNumber !== move.handNumber) {
      trick = { handNumber: move.handNumber, moves: [] };
      tricks.push(trick);
    }
    trick.moves.push(move);
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
}: PracticeHistoryDialogProps) => {
  const tricks = groupMoves(moveLog);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(88vh,54rem)] max-w-[min(96vw,72rem)] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-2xl text-center">
            Storico pratica
          </DialogTitle>
          <DialogDescription className="text-center">
            Carte giocate e segnali, mano per mano
          </DialogDescription>
        </DialogHeader>

        {hands && (
          <div className="flex justify-end border-b border-border pb-3">
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
          </div>
        )}

        <div
          className="min-h-0 flex-1 overflow-y-auto pr-2"
          data-testid="practice-history"
        >
          {tricks.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nessuna carta giocata.
            </p>
          ) : (
            <div className="space-y-6">
              {tricks.map((trick, trickIndex) => (
                <section
                  key={`${trick.handNumber ?? "unknown"}-${trickIndex}`}
                  className="space-y-3 border-b border-border pb-6 last:border-0"
                >
                  <h3 className="text-sm font-medium text-muted-foreground">
                    {trick.handNumber
                      ? `Mano ${trick.handNumber}`
                      : "Mano"}
                  </h3>
                  <ol className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    {trick.moves.map((move, moveIndex) => (
                      <li
                        key={`${move.suit}-${move.value}-${moveIndex}`}
                        className="flex min-w-0 items-center gap-3"
                      >
                        <PlayingCard
                          suit={move.suit}
                          value={move.value}
                          size="md"
                          className="h-24 w-16 shrink-0 rounded-sm"
                        />
                        <div className="min-w-0 text-sm">
                          <p className="truncate font-medium">
                            {move.username}
                          </p>
                          {move.signal && (
                            <Badge
                              variant="outline"
                              className={`mt-1 text-[10px] ${SIGNAL_STYLES[move.signal] ?? ""}`}
                            >
                              {move.signal}
                            </Badge>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          )}

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
                      <p className="text-sm text-muted-foreground">
                        Nessuna carta
                      </p>
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
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PracticeHistoryDialog;
