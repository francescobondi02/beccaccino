import { useEffect, useMemo, useState } from "react";
import type { AnnotationDifficulty } from "@/annotations/constants";
import type {
  AnnotationCard,
  AnnotationScenario as AnnotationScenarioModel,
  AnnotationSelectedAction,
  AnnotationSuit,
} from "@/annotations/model";
import {
  actionMatchesCard,
  historyFor,
  type SignalChoice,
} from "@/annotations/presentation";
import {
  DifficultyDialog,
  SkipCommentDialog,
} from "@/components/annotation/ResponseDialogs";
import ScenarioDecision from "@/components/annotation/ScenarioDecision";
import ScenarioSummary from "@/components/annotation/ScenarioSummary";
import ScenarioTrick from "@/components/annotation/ScenarioTrick";
import TrickHistoryDialog from "@/components/TrickHistoryDialog";

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
      <ScenarioSummary scenario={scenario} />

      {scenario.decisionType === "play_card" && (
        <ScenarioTrick
          scenario={scenario}
          onOpenHistory={() => setHistoryOpen(true)}
        />
      )}

      <ScenarioDecision
        scenario={scenario}
        selectedCard={selectedCard}
        selectedSuit={selectedSuit}
        signalChoice={signalChoice}
        isLeader={isLeader}
        isSubmitting={isSubmitting}
        canConfirm={selectedAction !== null}
        onCardSelect={(card) => {
          setSelectedCard(card);
          setSignalChoice(undefined);
        }}
        onSuitSelect={setSelectedSuit}
        onSignalSelect={setSignalChoice}
        onSkip={() => {
          setHistoryOpen(false);
          setSkipResponseTimeMs(responseTime());
          setSkipDialogOpen(true);
        }}
        onConfirm={() => {
          if (!selectedAction) return;
          openDifficulty({
            kind: "answer",
            action: selectedAction,
            responseTimeMs: responseTime(),
          });
        }}
      />

      {scenario.decisionType === "play_card" && (
        <TrickHistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          title="Storico della smazzata"
          description="Carte giocate e segnali, presa per presa"
          tricks={history}
          testId="annotation-history"
        />
      )}

      <SkipCommentDialog
        open={skipDialogOpen}
        comment={skipComment}
        isSubmitting={isSubmitting}
        onOpenChange={setSkipDialogOpen}
        onCommentChange={setSkipComment}
        onContinue={() =>
          openDifficulty({
            kind: "skip",
            comment: skipComment.trim() || null,
            responseTimeMs: skipResponseTimeMs,
          })
        }
      />

      <DifficultyDialog
        open={pendingDecision !== null}
        difficulty={difficulty}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        canLoadAnotherScenario={Boolean(onLoadAnotherScenario)}
        onOpenChange={(open) => {
          if (open) return;
          setPendingDecision(null);
          setDifficulty(null);
        }}
        onDifficultyChange={setDifficulty}
        onLoadAnotherScenario={onLoadAnotherScenario}
        onSubmit={submitRatedDecision}
      />
    </div>
  );
};

export default AnnotationScenario;
