import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleHelp,
  Crown,
  Flag,
  History,
  MessageCircle,
  Send,
  ShieldCheck,
  Target,
  Users,
} from "lucide-react";
import {
  ANNOTATION_DIFFICULTIES,
  type AnnotationDifficulty,
} from "@/annotations/constants";
import type {
  AnnotationCard,
  AnnotationPlay,
  AnnotationPlayCardAction,
  AnnotationPlayCardScenario,
  AnnotationScenario as AnnotationScenarioModel,
  AnnotationSeat,
  AnnotationSelectedAction,
  AnnotationSignal,
  AnnotationSuit,
  AnnotationTrick,
} from "@/annotations/model";
import PlayingCard from "@/components/PlayingCard";
import TrickHistoryDialog, {
  type HistoryTrick,
} from "@/components/TrickHistoryDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface AnnotationScenarioProps {
  scenario: AnnotationScenarioModel;
  startedAt: number;
  isSubmitting: boolean;
  errorMessage?: string | null;
  onLoadAnotherScenario?: () => void;
  onConfirm: (
    action: AnnotationSelectedAction,
    difficulty: AnnotationDifficulty,
    responseTimeMs: number,
  ) => void;
  onSkip: (
    comment: string | null,
    difficulty: AnnotationDifficulty,
    responseTimeMs: number,
  ) => void;
}

type RelativePosition = "bottom" | "left" | "top" | "right";
type SignalChoice = AnnotationSignal | undefined;
type PendingDecision =
  | {
      kind: "answer";
      action: AnnotationSelectedAction;
      responseTimeMs: number;
    }
  | {
      kind: "skip";
      comment: string | null;
      responseTimeMs: number;
    };

const POSITION_CLASS: Record<RelativePosition, string> = {
  top: "col-start-2 row-start-1 self-start",
  left: "col-start-1 row-start-2 justify-self-start",
  right: "col-start-3 row-start-2 justify-self-end",
  bottom: "col-start-2 row-start-3 self-end",
};

const SIGNAL_OPTIONS: Array<{
  value: AnnotationSignal;
  label: string;
}> = [
  { value: "striscio", label: "Striscio" },
  { value: "busso", label: "Busso" },
  { value: "volo", label: "Volo" },
  { value: null, label: "Niente" },
];

const SUIT_OPTIONS: Array<{
  value: AnnotationSuit;
  label: string;
  image: string;
}> = [
  {
    value: "denara",
    label: "Denara",
    image: "/images/semi/denara_seme.png",
  },
  { value: "coppe", label: "Coppe", image: "/images/semi/coppe_seme.png" },
  { value: "spade", label: "Spade", image: "/images/semi/spade_seme.png" },
  {
    value: "bastoni",
    label: "Bastoni",
    image: "/images/semi/bastoni_seme.png",
  },
];

function relativePosition(
  seat: AnnotationSeat,
  actingSeat: AnnotationSeat,
): RelativePosition {
  return (["bottom", "left", "top", "right"] as const)[
    (seat - actingSeat + 4) % 4
  ];
}

function seatLabel(seat: AnnotationSeat, actingSeat: AnnotationSeat): string {
  const position = relativePosition(seat, actingSeat);
  if (position === "bottom") return "Tu";
  if (position === "top") return "Socio";
  if (position === "left") return "Sinistra";
  return "Destra";
}

function scoreLabel(raw: number): string {
  const points = Math.floor(raw / 3);
  const figures = raw % 3;
  return `${points} ${points === 1 ? "punto" : "punti"} + ${figures} ${
    figures === 1 ? "figura" : "figure"
  }`;
}

function cardKey(card: AnnotationCard): string {
  return `${card.suit}:${card.value}`;
}

function actionMatchesCard(
  action: AnnotationPlayCardAction,
  card: AnnotationCard,
): boolean {
  return action.suit === card.suit && action.value === card.value;
}

function formatSignal(signal: AnnotationSignal): string {
  if (!signal) return "Nessun segnale";
  return signal.charAt(0).toUpperCase() + signal.slice(1);
}

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
          Mano {trick.number}
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

function historyFor(scenario: AnnotationPlayCardScenario): HistoryTrick[] {
  const completed = scenario.completedTricks.map((trick) => ({
    number: trick.number,
    winnerLabel: seatLabel(trick.winnerSeat, scenario.actingSeat),
    plays: trick.plays.map((play) => ({
      label: seatLabel(play.seat, scenario.actingSeat),
      suit: play.suit,
      value: play.value,
      signal:
        play.position === 0 && trick.signal ? trick.signal : null,
    })),
  }));
  if (scenario.currentTrick.plays.length === 0) return completed;
  return [
    ...completed,
    {
      number: scenario.currentTrick.number,
      current: true,
      plays: scenario.currentTrick.plays.map((play) => ({
        label: seatLabel(play.seat, scenario.actingSeat),
        suit: play.suit,
        value: play.value,
        signal:
          play.position === 0 && scenario.currentTrick.signal
            ? scenario.currentTrick.signal
            : null,
      })),
    },
  ];
}

const AnnotationScenario = ({
  scenario,
  startedAt,
  isSubmitting,
  errorMessage,
  onLoadAnotherScenario,
  onConfirm,
  onSkip,
}: AnnotationScenarioProps) => {
  const [selectedCard, setSelectedCard] = useState<AnnotationCard | null>(null);
  const [selectedSuit, setSelectedSuit] = useState<AnnotationSuit | null>(null);
  const [signalChoice, setSignalChoice] = useState<SignalChoice>(undefined);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [skipDialogOpen, setSkipDialogOpen] = useState(false);
  const [skipComment, setSkipComment] = useState("");
  const [skipResponseTimeMs, setSkipResponseTimeMs] = useState(0);
  const [pendingDecision, setPendingDecision] =
    useState<PendingDecision | null>(null);
  const [difficulty, setDifficulty] =
    useState<AnnotationDifficulty | null>(null);
  const history = useMemo(
    () => (scenario.decisionType === "play_card" ? historyFor(scenario) : []),
    [scenario],
  );

  useEffect(() => {
    setSelectedCard(null);
    setSelectedSuit(null);
    setSignalChoice(undefined);
    setHistoryOpen(false);
    setSkipDialogOpen(false);
    setSkipComment("");
    setPendingDecision(null);
    setDifficulty(null);
  }, [scenario.id]);

  const isLeader =
    scenario.decisionType === "play_card" &&
    scenario.actingSeat === scenario.currentTrick.starterSeat;
  const actingTeam = (scenario.actingSeat % 2) as 0 | 1;
  const opposingTeam = actingTeam === 0 ? 1 : 0;
  let selectedAction: AnnotationSelectedAction | null = null;
  if (scenario.decisionType === "choose_briscola" && selectedSuit) {
    if (scenario.legalActions.includes(selectedSuit)) {
      selectedAction = {
        decisionType: "choose_briscola",
        suit: selectedSuit,
      };
    }
  } else if (
    scenario.decisionType === "play_card" &&
    selectedCard &&
    (!isLeader || signalChoice !== undefined)
  ) {
    const action = scenario.legalActions.find(
      (candidate) =>
        actionMatchesCard(candidate, selectedCard) &&
        candidate.signal === (isLeader ? signalChoice : null),
    );
    if (action) {
      selectedAction = {
        decisionType: "play_card",
        ...action,
      };
    }
  }

  const responseTime = () => Math.max(0, Date.now() - startedAt);

  const openDifficulty = (decision: PendingDecision) => {
    setHistoryOpen(false);
    setSkipDialogOpen(false);
    setDifficulty(null);
    setPendingDecision(decision);
  };

  const submitRatedDecision = () => {
    if (!pendingDecision || !difficulty) return;
    if (pendingDecision.kind === "answer") {
      onConfirm(
        pendingDecision.action,
        difficulty,
        pendingDecision.responseTimeMs,
      );
    } else {
      onSkip(
        pendingDecision.comment,
        difficulty,
        pendingDecision.responseTimeMs,
      );
    }
  };

  return (
    <div className="min-w-0 space-y-6">
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

      {scenario.decisionType === "play_card" && (
        <Card className="border-border/70">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-lg">Mano in corso</CardTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="Storico del round"
              aria-label="Apri storico del round"
              onClick={() => setHistoryOpen(true)}
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
      )}

      <Card className="border-border/70">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">La tua mano</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {scenario.decisionType === "play_card" ? (
            <div className="overflow-x-auto pb-3">
              <div className="flex min-w-max gap-3 px-1 pt-2">
                {scenario.hand.map((card) => {
                  const legal = scenario.legalActions.some((action) =>
                    actionMatchesCard(action, card),
                  );
                  const selected =
                    selectedCard !== null &&
                    cardKey(selectedCard) === cardKey(card);
                  return (
                    <button
                      key={cardKey(card)}
                      type="button"
                      className={cn(
                        "rounded-md p-1 outline-none ring-offset-2 transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                        selected && "bg-primary/10 ring-2 ring-primary",
                      )}
                      aria-label={`Seleziona ${card.value} di ${card.suit}`}
                      aria-pressed={selected}
                      disabled={!legal || isSubmitting}
                      onClick={() => {
                        setSelectedCard(card);
                        setSignalChoice(undefined);
                      }}
                    >
                      <PlayingCard
                        suit={card.suit}
                        value={card.value}
                        size="md"
                        disabled={!legal}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              <div
                className="flex flex-wrap justify-center gap-2 px-1 pt-2 sm:gap-3"
                data-testid="annotation-briscola-hand"
              >
                {scenario.hand.map((card) => (
                  <PlayingCard
                    key={cardKey(card)}
                    suit={card.suit}
                    value={card.value}
                    size="md"
                  />
                ))}
              </div>
              <div
                className="space-y-3 border-t border-border pt-4"
                role="radiogroup"
                aria-label="Seleziona la briscola"
              >
                <p className="text-sm font-semibold">Scegli la briscola</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {SUIT_OPTIONS.map((suit) => {
                    const allowed = scenario.legalActions.includes(suit.value);
                    return (
                      <Button
                        key={suit.value}
                        type="button"
                        role="radio"
                        variant={
                          selectedSuit === suit.value ? "default" : "outline"
                        }
                        className="h-20 flex-col gap-1 px-2 sm:h-24"
                        disabled={!allowed || isSubmitting}
                        aria-label={`Scegli ${suit.label} come briscola`}
                        aria-checked={selectedSuit === suit.value}
                        onClick={() => setSelectedSuit(suit.value)}
                      >
                        <img
                          src={suit.image}
                          alt=""
                          className="h-9 w-9 object-contain sm:h-10 sm:w-10"
                        />
                        <span>{suit.label}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {scenario.decisionType === "play_card" &&
            isLeader &&
            selectedCard && (
              <div
                className="space-y-3"
                data-testid="annotation-signal-choice"
              >
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-primary" />
                  <p className="text-sm font-semibold">
                    Scegli esplicitamente il segnale
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {SIGNAL_OPTIONS.map((option) => {
                    const allowed = scenario.legalActions.some(
                      (action) =>
                        actionMatchesCard(action, selectedCard) &&
                        action.signal === option.value,
                    );
                    return (
                      <Button
                        key={option.label}
                        type="button"
                        variant={
                          signalChoice === option.value ? "default" : "outline"
                        }
                        disabled={!allowed || isSubmitting}
                        aria-pressed={signalChoice === option.value}
                        onClick={() => setSignalChoice(option.value)}
                      >
                        {option.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}

          <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              className="w-full sm:w-auto"
              disabled={isSubmitting}
              onClick={() => {
                setHistoryOpen(false);
                setSkipResponseTimeMs(responseTime());
                setSkipDialogOpen(true);
              }}
            >
              <CircleHelp className="h-4 w-4" />
              Non sono sicuro
            </Button>
            <Button
              type="button"
              variant="gradient"
              className="w-full sm:w-auto"
              disabled={!selectedAction || isSubmitting}
              onClick={() =>
                selectedAction &&
                openDifficulty({
                  kind: "answer",
                  action: selectedAction,
                  responseTimeMs: responseTime(),
                })
              }
            >
              <CheckCircle2 className="h-4 w-4" />
              Conferma scelta
            </Button>
          </div>
        </CardContent>
      </Card>

      {scenario.decisionType === "play_card" && (
        <TrickHistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          title="Storico del round"
          description="Carte giocate e segnali, mano per mano"
          tricks={history}
          testId="annotation-history"
        />
      )}

      <Dialog
        open={skipDialogOpen}
        onOpenChange={(open) => {
          if (!isSubmitting) setSkipDialogOpen(open);
        }}
      >
        <DialogContent className="z-[60] max-w-md bg-card">
          <DialogHeader>
            <DialogTitle>Aggiungi un commento</DialogTitle>
            <DialogDescription>
              Motivo del dubbio, opzionale.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="annotation-skip-comment">
              Perché non sei sicuro?
            </Label>
            <textarea
              id="annotation-skip-comment"
              className="flex min-h-28 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={skipComment}
              maxLength={500}
              disabled={isSubmitting}
              onChange={(event) => setSkipComment(event.target.value)}
            />
            <p className="text-right text-xs tabular-nums text-muted-foreground">
              {Array.from(skipComment).length}/500
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => setSkipDialogOpen(false)}
            >
              Annulla
            </Button>
            <Button
              type="button"
              disabled={isSubmitting}
              onClick={() =>
                openDifficulty({
                  kind: "skip",
                  comment: skipComment.trim() || null,
                  responseTimeMs: skipResponseTimeMs,
                })
              }
            >
              <Send className="h-4 w-4" />
              Continua
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingDecision !== null}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) {
            setPendingDecision(null);
            setDifficulty(null);
          }
        }}
      >
        <DialogContent className="z-[70] max-w-md bg-card">
          <DialogHeader>
            <DialogTitle>Quanto era difficile?</DialogTitle>
            <DialogDescription>
              Valuta lo scenario indipendentemente dalla tua scelta.
            </DialogDescription>
          </DialogHeader>
          <div
            className="grid grid-cols-3 gap-2"
            role="group"
            aria-label="Difficoltà percepita"
          >
            {ANNOTATION_DIFFICULTIES.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={difficulty === option.value ? "default" : "outline"}
                aria-pressed={difficulty === option.value}
                disabled={isSubmitting}
                onClick={() => setDifficulty(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
          {errorMessage && (
            <div
              className="space-y-3 border-l-4 border-destructive bg-destructive/5 px-3 py-2"
              role="alert"
            >
              <p className="text-sm text-destructive">{errorMessage}</p>
              {onLoadAnotherScenario && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={onLoadAnotherScenario}
                >
                  Carica un altro scenario
                </Button>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              className="w-full sm:w-auto"
              disabled={
                !difficulty || isSubmitting || Boolean(onLoadAnotherScenario)
              }
              onClick={submitRatedDecision}
            >
              <Send className="h-4 w-4" />
              {isSubmitting ? "Invio..." : "Invia risposta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AnnotationScenario;
