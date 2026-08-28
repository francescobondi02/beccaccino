import { Card } from "@/components/ui/card";
import type { TotalPoints } from "@/game/model";
import { pointsForPlayerTeam } from "@/game/presentation";

interface GameScoreHeaderProps {
  roomCode: string | undefined;
  briscola: string | null | undefined;
  roundNumber: number | undefined;
  handNumber: number | null;
  playerTeam: number | null;
  totalPoints: TotalPoints;
}

export default function GameScoreHeader({
  roomCode,
  briscola,
  roundNumber,
  handNumber,
  playerTeam,
  totalPoints,
}: GameScoreHeaderProps) {
  const points = pointsForPlayerTeam(totalPoints, playerTeam);

  return (
    <>
      <div className="absolute top-4 right-4 text-sm text-muted-foreground">
        Room: <span className="font-semibold text-foreground">{roomCode}</span>
      </div>

      {briscola && (
        <Card className="absolute top-4 left-4 px-4 py-3 shadow-lg border-2 bg-card/80 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <img
              src={`/images/semi/${briscola}_seme.png`}
              alt={briscola}
              className="w-8 h-8 object-contain"
            />
            <div>
              <div className="text-xs text-muted-foreground">Briscola</div>
              <div className="text-sm font-bold capitalize">{briscola}</div>
            </div>
          </div>
        </Card>
      )}

      <div className="container absolute inset-x-0 top-4 mx-auto flex justify-center px-4">
        <Card
          className="px-6 py-3 shadow-lg border-2 bg-card/80 backdrop-blur-sm"
          data-testid="team-points-panel"
        >
          {handNumber && roundNumber && (
            <div className="text-center text-xs text-muted-foreground mb-2 border-b border-border pb-1">
              Round {roundNumber} &middot; Mano {handNumber}/10
            </div>
          )}
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1">
                La tua squadra (Team {(playerTeam ?? 0) + 1})
              </div>
              <div
                className="text-2xl font-bold text-primary"
                data-testid="my-team-points"
              >
                {points.own}
              </div>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1">
                Avversari (Team {((playerTeam ?? 0) === 0 ? 1 : 0) + 1})
              </div>
              <div
                className="text-2xl font-bold text-accent"
                data-testid="opponent-team-points"
              >
                {points.opponents}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
