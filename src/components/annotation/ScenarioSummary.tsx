import { Crown, Flag, ShieldCheck, Target, Users } from "lucide-react";
import type { AnnotationScenario } from "@/annotations/model";
import { scoreLabel, seatLabel } from "@/annotations/presentation";
import { cn } from "@/lib/utils";

interface ScenarioSummaryProps {
  scenario: AnnotationScenario;
}

export default function ScenarioSummary({ scenario }: ScenarioSummaryProps) {
  const actingTeam = (scenario.actingSeat % 2) as 0 | 1;
  const opposingTeam = actingTeam === 0 ? 1 : 0;

  return (
    <>
      <section
        className={cn(
          "grid gap-3 sm:grid-cols-2",
          scenario.decisionType === "play_card" && "lg:grid-cols-4",
        )}
      >
        <div className="flex min-w-0 items-center gap-3 border-b border-border px-1 py-3 sm:border-b-0 sm:border-r">
          <Target className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Round</p>
            <p className="truncate font-semibold">
              {scenario.roundNumber} · obiettivo {scenario.targetPoints}
            </p>
          </div>
        </div>
        <div
          className={cn(
            "flex min-w-0 items-center gap-3 border-b border-border px-1 py-3 sm:border-b-0",
            scenario.decisionType === "play_card" && "lg:border-r",
          )}
        >
          <Crown className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Chiamante</p>
            <p className="truncate font-semibold">
              {seatLabel(scenario.callerSeat, scenario.actingSeat)}
            </p>
          </div>
        </div>
        {scenario.decisionType === "play_card" && (
          <>
            <div className="flex min-w-0 items-center gap-3 border-b border-border px-1 py-3 sm:border-b-0 sm:border-r">
              <Flag className="h-5 w-5 shrink-0 text-accent" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Apre la mano</p>
                <p className="truncate font-semibold">
                  {seatLabel(scenario.trickStarter, scenario.actingSeat)}
                </p>
              </div>
            </div>
            <div className="flex min-w-0 items-center gap-3 px-1 py-3">
              <img
                src={`/images/semi/${scenario.briscola}_seme.png`}
                alt=""
                className="h-8 w-8 shrink-0 object-contain"
              />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Briscola</p>
                <p className="truncate font-semibold capitalize">
                  {scenario.briscola}
                </p>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2" aria-label="Punteggio totale">
        <div className="border-l-4 border-primary bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4" />
            La tua squadra
          </div>
          <p className="mt-1 text-lg font-semibold">
            {scoreLabel(scenario.totalScores[actingTeam])}
          </p>
        </div>
        <div className="border-l-4 border-accent bg-accent/5 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            Avversari
          </div>
          <p className="mt-1 text-lg font-semibold">
            {scoreLabel(scenario.totalScores[opposingTeam])}
          </p>
        </div>
      </section>
    </>
  );
}
