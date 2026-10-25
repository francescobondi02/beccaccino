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
  const briscolaLabel = briscola === "denara" ? "denari" : briscola;

  return (
    <>
      <div className="arcade-room-code absolute right-4 top-4 hidden rounded-full border border-border/70 bg-card/80 px-3 py-1 text-xs text-muted-foreground backdrop-blur-sm sm:block">
        Tavolo <span className="font-mono font-semibold tracking-wider text-foreground">{roomCode}</span>
      </div>

      {briscola && (
        <Card className="arcade-briscola-panel circolo-panel absolute left-4 top-4 hidden border-[hsl(39_45%_50%_/_0.5)] px-4 py-3 backdrop-blur-sm sm:block">
          <div className="flex items-center gap-3">
            <img
              src={`/images/semi/${briscola}_seme.png`}
              alt={briscolaLabel ?? ""}
              className="w-8 h-8 object-contain"
            />
            <div>
              <div className="text-xs text-muted-foreground">Briscola</div>
              <div className="text-sm font-bold capitalize">{briscolaLabel}</div>
            </div>
          </div>
        </Card>
      )}

      <div className="arcade-score-dock container absolute inset-x-0 top-4 mx-auto flex justify-center px-4">
        <Card
          className="arcade-score-panel circolo-panel border-[hsl(39_45%_50%_/_0.6)] px-5 py-2.5 backdrop-blur-sm"
          data-testid="team-points-panel"
        >
          {handNumber && roundNumber && (
            <div className="text-center text-xs text-muted-foreground mb-2 border-b border-border pb-1">
              Smazzata {roundNumber}<span className="arcade-score-sep"> &middot; </span>Presa {handNumber}/10
            </div>
          )}
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1">
                Noi<span className="arcade-team-number"> · Squadra {(playerTeam ?? 0) + 1}</span>
              </div>
              <div
                className="font-mono text-2xl font-bold tabular-nums text-primary"
                data-testid="my-team-points"
              >
                {points.own}
              </div>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-1">
                Loro<span className="arcade-team-number"> · Squadra {((playerTeam ?? 0) === 0 ? 1 : 0) + 1}</span>
              </div>
              <div
                className="font-mono text-2xl font-bold tabular-nums text-accent"
                data-testid="opponent-team-points"
              >
                {points.opponents}
              </div>
            </div>
          </div>
          {briscola && (
            <div className="arcade-mobile-trump">
              <img src={`/images/semi/${briscola}_seme.png`} alt="" className="mr-1 inline-block h-5 w-5 object-contain align-middle" />
              <span className="arcade-trump-label">Briscola: </span><strong>{briscolaLabel}</strong>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
