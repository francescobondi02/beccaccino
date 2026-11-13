import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import type { RoundEndData, TotalPoints } from "@/game/model";
import type { ReactNode } from "react";

interface RoundEndDialogProps {
  open: boolean;
  result: RoundEndData;
  totalPoints: TotalPoints;
  myTeam: number | null;
  callerName: string;
  practiceActions?: ReactNode;
}

export default function RoundEndDialog({
  open, result, totalPoints, myTeam, callerName, practiceActions,
}: RoundEndDialogProps) {
  return (
    <Dialog open={open}>
      <DialogContent className="[&>button:last-child]:hidden" onEscapeKeyDown={(event) => event.preventDefault()} onPointerDownOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Smazzata {result.roundNumber} conclusa</DialogTitle>
          <DialogDescription>
            {myTeam === result.winnerTeam ? "La tua squadra ha vinto questa smazzata." : "Gli avversari hanno vinto questa smazzata."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          {([0, 1] as const).map((team) => (
            <div key={team} className={`rounded-lg border p-4 ${team === result.winnerTeam ? "border-primary" : "border-border"}`}>
              <h3 className="font-bold">Squadra {team + 1}{team === myTeam ? " · La tua" : ""}</h3>
              <p className="mt-2 text-2xl font-bold">{team === 0 ? result.team0Points : result.team1Points} punti</p>
              <p className="text-sm text-muted-foreground">{(team === 0 ? result.team0Figures : result.team1Figures) ?? 0} figure</p>
              <p className="mt-3 text-sm">
                Totale: {team === 0 ? totalPoints.team0Points : totalPoints.team1Points} punti · {team === 0 ? totalPoints.team0Figures : totalPoints.team1Figures} figure
              </p>
            </div>
          ))}
        </div>
        <p className="text-center text-sm">Prossima briscola: <strong>{callerName}</strong></p>
        <p className="text-center text-sm text-muted-foreground">Tra pochi secondi distribuiamo le carte...</p>
        {practiceActions}
      </DialogContent>
    </Dialog>
  );
}
