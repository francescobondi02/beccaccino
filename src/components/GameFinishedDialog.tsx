import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trophy, Award, Target, TrendingUp, Loader2 } from "lucide-react";

interface GameFinishedDialogProps {
  open: boolean;
  winnerTeam: number;
  totalRounds: number;
  finalScores: {
    team0: number;
    team1: number;
  };
  roundsWon: {
    team0: number;
    team1: number;
  };
  myTeam: number | null;
  onHome: () => Promise<void>;
  isReturningHome: boolean;
}

const GameFinishedDialog = ({
  open,
  winnerTeam,
  totalRounds,
  finalScores,
  roundsWon,
  myTeam,
  onHome,
  isReturningHome,
}: GameFinishedDialogProps) => {
  const isMyTeamWinner = myTeam === winnerTeam;

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-2xl border-[hsl(39_45%_50%_/_0.7)] bg-card shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-3xl font-bold text-center flex items-center justify-center gap-3 mb-2">
            <Trophy
              className={`h-8 w-8 ${isMyTeamWinner ? "text-yellow-500 animate-bounce" : "text-muted-foreground"}`}
            />
            {isMyTeamWinner ? "Vittoria" : "Partita terminata"}
          </DialogTitle>
          <DialogDescription className="text-center text-lg">
            {isMyTeamWinner
              ? "La tua squadra ha vinto la partita!"
              : `La squadra ${winnerTeam + 1} ha vinto la partita.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-6">
          {/* Punteggi Finali */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
              <Target className="h-4 w-4" />
              Punteggio finale
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Team 0 */}
              <div
                className={`p-6 rounded-lg border-2 ${
                  winnerTeam === 0
                    ? "border-yellow-500 bg-yellow-500/10 shadow-lg"
                    : "border-border bg-card"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-lg">Squadra 1</span>
                    {myTeam === 0 && (
                      <Badge variant="secondary" className="text-xs">
                        La tua
                      </Badge>
                    )}
                  </div>
                  {winnerTeam === 0 && (
                    <Trophy className="h-6 w-6 text-yellow-500" />
                  )}
                </div>
                <div className="text-4xl font-bold text-center text-primary">
                  {finalScores.team0}
                </div>
                <div className="text-xs text-muted-foreground text-center mt-2">
                  punti totali
                </div>
              </div>

              {/* Team 1 */}
              <div
                className={`p-6 rounded-lg border-2 ${
                  winnerTeam === 1
                    ? "border-yellow-500 bg-yellow-500/10 shadow-lg"
                    : "border-border bg-card"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-lg">Squadra 2</span>
                    {myTeam === 1 && (
                      <Badge variant="secondary" className="text-xs">
                        La tua
                      </Badge>
                    )}
                  </div>
                  {winnerTeam === 1 && (
                    <Trophy className="h-6 w-6 text-yellow-500" />
                  )}
                </div>
                <div className="text-4xl font-bold text-center text-primary">
                  {finalScores.team1}
                </div>
                <div className="text-xs text-muted-foreground text-center mt-2">
                  punti totali
                </div>
              </div>
            </div>
          </div>

          {/* Statistiche */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Statistiche della partita
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Round giocati */}
              <div className="p-4 rounded-lg bg-secondary/50">
                <div className="flex items-center gap-2 mb-2">
                  <Award className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Smazzate giocate</span>
                </div>
                <div className="text-2xl font-bold">{totalRounds}</div>
              </div>

              {/* Round vinti Team 1 */}
              <div className="p-4 rounded-lg bg-secondary/50">
                <div className="flex items-center gap-2 mb-2">
                  <Trophy className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">
                    Smazzate vinte · Squadra 1
                  </span>
                </div>
                <div className="text-2xl font-bold">{roundsWon.team0}</div>
              </div>

              {/* Round vinti Team 2 */}
              <div className="p-4 rounded-lg bg-secondary/50">
                <div className="flex items-center gap-2 mb-2">
                  <Trophy className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">
                    Smazzate vinte · Squadra 2
                  </span>
                </div>
                <div className="text-2xl font-bold">{roundsWon.team1}</div>
              </div>

              {/* Media punti per round */}
              <div className="p-4 rounded-lg bg-secondary/50">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Media punti</span>
                </div>
                <div className="text-xl font-bold">
                  {(
                    (finalScores.team0 + finalScores.team1) /
                    totalRounds
                  ).toFixed(1)}{" "}
                  <span className="text-xs text-muted-foreground">/ smazzata</span>
                </div>
              </div>
            </div>
          </div>

          {/* Bottone per tornare alla home */}
          <div className="pt-4">
            <Button
              variant="gradient"
              className="w-full"
              onClick={() => void onHome()}
              disabled={isReturningHome}
            >
              {isReturningHome ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uscita in corso...
                </>
              ) : (
                "Torna alla home"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default GameFinishedDialog;
