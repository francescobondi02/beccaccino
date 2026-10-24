import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Trophy } from "lucide-react";

interface RoundEndDialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  roundNumber: number;
  team0Points: number;
  team1Points: number;
  winnerTeam: number;
  myTeam: number | null;
}

const RoundEndDialog = ({
  open,
  onOpenChange,
  roundNumber,
  team0Points,
  team1Points,
  winnerTeam,
  myTeam,
}: RoundEndDialogProps) => {
  const isMyTeamWinner = myTeam === winnerTeam;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md border-[hsl(39_45%_50%_/_0.7)] bg-card shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center flex items-center justify-center gap-2">
            <Trophy
              className={`h-6 w-6 ${isMyTeamWinner ? "text-yellow-500" : "text-muted-foreground"}`}
            />
            Smazzata {roundNumber} conclusa
          </DialogTitle>
          <DialogDescription className="text-center">
            {isMyTeamWinner
              ? "La tua squadra ha vinto questa smazzata."
              : "Gli avversari hanno vinto questa smazzata."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Team 0 */}
          <div
            className={`p-4 rounded-lg border-2 ${
              winnerTeam === 0
                ? "border-primary bg-primary/10"
                : "border-border bg-card"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="font-bold">Squadra 1</span>
                {myTeam === 0 && (
                  <Badge variant="secondary" className="text-xs">
                    La tua
                  </Badge>
                )}
                {winnerTeam === 0 && (
                  <Trophy className="h-4 w-4 text-yellow-500" />
                )}
              </div>
            </div>
            <div className="text-2xl font-bold text-center">{team0Points}</div>
            <div className="text-xs text-muted-foreground text-center mt-1">
              punti
            </div>
          </div>

          {/* Team 1 */}
          <div
            className={`p-4 rounded-lg border-2 ${
              winnerTeam === 1
                ? "border-primary bg-primary/10"
                : "border-border bg-card"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="font-bold">Squadra 2</span>
                {myTeam === 1 && (
                  <Badge variant="secondary" className="text-xs">
                    La tua
                  </Badge>
                )}
                {winnerTeam === 1 && (
                  <Trophy className="h-4 w-4 text-yellow-500" />
                )}
              </div>
            </div>
            <div className="text-2xl font-bold text-center">{team1Points}</div>
            <div className="text-xs text-muted-foreground text-center mt-1">
              punti
            </div>
          </div>
        </div>

        <div className="text-center text-sm text-muted-foreground mt-4">
          Prepariamo la prossima smazzata...
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RoundEndDialog;
