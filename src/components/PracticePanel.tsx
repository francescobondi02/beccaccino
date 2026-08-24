import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, EyeOff } from "lucide-react";
import MoveLog from "@/components/MoveLog";
import type { MoveLogEntry, RevealedHand } from "@/game/model";

interface PracticePanelProps {
  moveLog: MoveLogEntry[];
  hands: RevealedHand[] | null;
  revealed: boolean;
  onToggleReveal: () => void;
  usernameOf: (userId: number) => string;
}

/**
 * The diagnostic surface for practice games: what the bots played, and what they
 * were holding when they played it.
 *
 * Kept as a sibling of `GameTable` rather than folded into it — GameTable is
 * already ~1100 dense lines, and none of this belongs in the game itself.
 *
 * Seeing the hands is what makes a signal checkable: a "volo" is a lie unless
 * the declarer is genuinely out of that suit, and a "striscio" is empty unless
 * real strength backs it. The data only arrives for practice rooms; the server
 * decides that, so this cannot be turned on in a real game.
 */
const PracticePanel = ({
  moveLog,
  hands,
  revealed,
  onToggleReveal,
  usernameOf,
}: PracticePanelProps) => (
  <div className="space-y-4">
    <MoveLog entries={moveLog} />

    {hands && (
      <Card className="bg-gradient-card border-border/50">
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Mani scoperte</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleReveal}
              data-testid="toggle-reveal-hands"
            >
              {revealed ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </Button>
          </div>

          {revealed ? (
            <div className="space-y-2">
              {hands.map((hand) => (
                <div key={hand.userId} className="text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{usernameOf(hand.userId)}</span>
                    {hand.botModel && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {hand.botModel}
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground">
                    {hand.cards.length === 0
                      ? "nessuna carta"
                      : hand.cards
                          .map((card) => `${card.value} di ${card.suit}`)
                          .join(", ")}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Mostra le carte di tutti per controllare se i segni dei bot sono
              onesti.
            </p>
          )}
        </CardContent>
      </Card>
    )}
  </div>
);

export default PracticePanel;
