import { History } from "lucide-react";
import type {
  AnnotationPlay,
  AnnotationPlayCardScenario,
  AnnotationSeat,
  AnnotationTrick,
} from "@/annotations/model";
import {
  cardKey,
  formatSignal,
  relativePosition,
  seatLabel,
  type RelativePosition,
} from "@/annotations/presentation";
import PlayingCard from "@/components/PlayingCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const POSITION_CLASS: Record<RelativePosition, string> = {
  top: "col-start-2 row-start-1 self-start",
  left: "col-start-1 row-start-2 justify-self-start",
  right: "col-start-3 row-start-2 justify-self-end",
  bottom: "col-start-2 row-start-3 self-end",
};

function TrickCard({
  play,
  actingSeat,
}: {
  play: AnnotationPlay;
  actingSeat: AnnotationSeat;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col items-center gap-1",
        POSITION_CLASS[relativePosition(play.seat, actingSeat)],
      )}
    >
      <span className="max-w-20 truncate text-xs font-medium text-muted-foreground">
        {seatLabel(play.seat, actingSeat)}
      </span>
      <PlayingCard suit={play.suit} value={play.value} size="sm" />
    </div>
  );
}

function CurrentTrick({
  trick,
  actingSeat,
}: {
  trick: AnnotationTrick;
  actingSeat: AnnotationSeat;
}) {
  return (
    <div
      className="grid h-64 w-full max-w-md grid-cols-[minmax(4.5rem,1fr)_minmax(5rem,1fr)_minmax(4.5rem,1fr)] grid-rows-3 items-center gap-2"
      data-testid="annotation-current-trick"
    >
      {trick.plays.map((play) => (
        <TrickCard
          key={`${play.position}-${play.seat}-${cardKey(play)}`}
          play={play}
          actingSeat={actingSeat}
        />
      ))}
      <div className="col-start-2 row-start-2 min-w-0 text-center">
        <p className="text-xs font-semibold uppercase text-muted-foreground">
          Presa {trick.number}
        </p>
        <p className="mt-1 text-sm font-medium">Tocca a te</p>
        {trick.signal && (
          <p className="mt-1 truncate text-xs text-primary">
            {formatSignal(trick.signal)} ·{" "}
            {trick.signalSeat === null
              ? ""
              : seatLabel(trick.signalSeat, actingSeat)}
          </p>
        )}
      </div>
    </div>
  );
}

interface ScenarioTrickProps {
  scenario: AnnotationPlayCardScenario;
  onOpenHistory: () => void;
}

export default function ScenarioTrick({
  scenario,
  onOpenHistory,
}: ScenarioTrickProps) {
  return (
    <Card className="border-border/70">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg">Presa in corso</CardTitle>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="Storico della smazzata"
          aria-label="Apri storico della smazzata"
          onClick={onOpenHistory}
        >
          <History className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="flex justify-center px-3 sm:px-6">
        <CurrentTrick
          trick={scenario.currentTrick}
          actingSeat={scenario.actingSeat}
        />
      </CardContent>
    </Card>
  );
}
