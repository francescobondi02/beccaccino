import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import TrumpSuitDialog from "@/components/TrumpSuitDialog";
import LastTrickDialog from "@/components/LastTrickDialog";
import RoundEndDialog from "@/components/RoundEndDialog";
import GameResult from "@/components/GameResult";
import GameChat from "@/components/GameChat";
import SignalDialog from "@/components/SignalDialog";
import ConnectionBanner from "@/components/ConnectionBanner";
import AuthErrorState from "@/components/AuthErrorState";
import GameBoard from "@/components/game/GameBoard";
import GameScoreHeader from "@/components/game/GameScoreHeader";
import PausedPracticeDialog from "@/components/game/PausedPracticeDialog";
import GameActions from "@/components/game/GameActions";
import { AlertCircle, Crown, History, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { Card as PlayingCard, Signal } from "@contract/cards";
import type { GameState } from "@contract/game";
import { apiPost, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useGameTable } from "@/hooks/useGameTable";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { useTurnCountdown } from "@/hooks/useTurnCountdown";
import { useRoundDeal } from "@/hooks/useRoundDeal";
import { positionPlayers } from "@/game/presentation";

const LOAD_ERRORS: Record<number, { message: string; leaveTo: (roomCode: string) => string }> = {
  404: { message: "La stanza non esiste più", leaveTo: () => "/" },
  403: { message: "Non sei un giocatore in questa stanza", leaveTo: () => "/" },
  400: { message: "La partita non è ancora iniziata", leaveTo: (roomCode) => `/room/${roomCode}` },
};

const GameTable = () => {
  const { gameRoomCode } = useParams();
  const navigate = useNavigate();
  const {
    user,
    loading: authLoading,
    error: authError,
    retry: retryAuth,
  } = useAuth({ redirectOnFail: true });
  const userId = user?.id ?? null;

  const {
    gameState,
    error: loadError,
    notice,
    completedTrick,
    fastCollection,
    playedCards,
    animatedCard,
    currentSignal,
    currentTurnUserId,
    turnDeadline,
    playableCards,
    roundDeal,
    applyGameState,
    refetchGameState,
  } = useGameTable(gameRoomCode, userId);
  const round = gameState?.round;
  const result = gameState?.result ?? null;
  const gameStatus = gameState?.status;
  const myHand = gameState?.myHand ?? [];
  const myPlayer =
    gameState?.players.find((player) => player.userId === userId) ?? null;
  const connectionStatus = useConnectionStatus();
  const countdown = useTurnCountdown(turnDeadline);
  const deal = useRoundDeal(
    roundDeal,
    !completedTrick && gameStatus === "choosing_briscola" && round?.briscola === null,
  );
  const roundSummary = gameState?.roundSummary ?? null;
  const showRoundSummary = Boolean(roundSummary) && deal.phase === "collecting";
  const myBotControlled = Boolean(myPlayer?.botModel);

  const [lastTrickDialogOpen, setLastTrickDialogOpen] = useState(false);
  const [isReturningHome, setIsReturningHome] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [confirmPausedAbandon, setConfirmPausedAbandon] = useState(false);

  // Leader card waiting for a signal choice
  const [pendingCard, setPendingCard] = useState<PlayingCard | null>(null);
  const [isPlayingCard, setIsPlayingCard] = useState(false);
  const signalDialogOpen = pendingCard !== null && !isPlayingCard;
  const [isChoosingTrump, setIsChoosingTrump] = useState(false);

  const cleanupRoom = useCallback(async (): Promise<void> => {
    if (!gameState || (!gameState.isPractice && gameState.result) || !gameRoomCode) return;

    try {
      await apiPost(`/rooms/${gameRoomCode}/leave`, {});
    } catch (error) {
      if (gameState.isPractice && error instanceof ApiError && error.status === 404) return;
      throw error;
    }
  }, [gameRoomCode, gameState]);

  useEffect(() => {
    if (isReturningHome || !gameRoomCode || !(loadError instanceof ApiError)) return;
    const loadErrorAction = LOAD_ERRORS[loadError.status];
    if (!loadErrorAction) return;
    toast.error(loadErrorAction.message);
    navigate(loadErrorAction.leaveTo(gameRoomCode));
  }, [loadError, isReturningHome, gameRoomCode, navigate]);

  useEffect(() => {
    if (myPlayer?.abandoned && !result) navigate("/");
    if (myBotControlled) setPendingCard(null);
  }, [myPlayer?.abandoned, myBotControlled, result, navigate]);

  // Il caller vede il dialog briscola (non chiudibile) finché non sceglie.
  const trumpDialogOpen =
    gameStatus !== "paused" &&
    !myBotControlled &&
    !completedTrick &&
    deal.phase === "ready" &&
    myHand.length > 0 &&
    round?.briscola === null &&
    round.callerUserId === userId &&
    !showRoundSummary &&
    !result;

  useEffect(() => {
    if (gameStatus === "paused") setPendingCard(null);
    else setConfirmPausedAbandon(false);
  }, [gameStatus]);

  useEffect(() => {
    if (pendingCard && (
      currentTurnUserId !== userId ||
      playedCards.length > 0 ||
      !gameState?.myHand.some((card) => card.suit === pendingCard.suit && card.value === pendingCard.value)
    )) {
      setPendingCard(null);
    }
  }, [pendingCard, currentTurnUserId, userId, playedCards.length, gameState?.myHand]);

  const playersWithPositions = positionPlayers(gameState?.players ?? [], userId);

  const sendPlayCard = async (
    card: PlayingCard,
    signal?: Signal | null,
  ) => {
    setIsPlayingCard(true);
    try {
      applyGameState(await apiPost<GameState>(`/games/${gameRoomCode}/cards`, {
        suit: card.suit,
        value: card.value,
        signal: signal || null,
      }));
    } catch (error) {
      const message =
        error instanceof ApiError ? error.body?.error : undefined;
      toast.error(message || "Errore nel giocare la carta");
      await refetchGameState();
    } finally {
      setPendingCard(null);
      setIsPlayingCard(false);
    }
  };

  // GameBoard only enables my playable cards on my turn.
  const handleCardClick = async (card: PlayingCard) => {
    if (isPlayingCard) return;

    // If trick leader (no cards on table), show signal dialog
    if (playedCards.length === 0) {
      setPendingCard(card);
      return;
    }

    // Not trick leader — play immediately
    await sendPlayCard(card);
  };

  const handleSignalSelect = async (signal: Signal | null) => {
    if (!isPlayingCard && pendingCard) await sendPlayCard(pendingCard, signal);
  };

  const handleTrumpSelect = async (suit: string) => {
    if (!myPlayer || isChoosingTrump) return;
    setIsChoosingTrump(true);
    try {
      applyGameState(await apiPost<GameState>(`/games/${gameRoomCode}/briscola`, { suit }));
      toast.success(`Briscola scelta: ${suit === "denara" ? "denari" : suit}`);
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.body?.error || "Errore nella scelta della briscola");
      } else {
        console.error("Error choosing briscola:", error);
        toast.error("Errore nella scelta della briscola");
      }
    } finally {
      setIsChoosingTrump(false);
    }
  };

  const handleReturnHome = async () => {
    setIsReturningHome(true);
    try {
      await cleanupRoom();
      navigate("/");
    } catch (error) {
      console.error("Error leaving game:", error);
      toast.error("Impossibile abbandonare la partita. Riprova.");
      setIsReturningHome(false);
    }
  };

  const roomAction = async (
    action: "pause" | "resume" | "resume-control",
    setBusy: (busy: boolean) => void,
    failure: string,
    onSuccess: () => unknown,
  ) => {
    setBusy(true);
    try {
      await apiPost(`/rooms/${gameRoomCode}/${action}`, {});
      await onSuccess();
    } catch (error) {
      console.error(`Error on ${action}:`, error);
      toast.error(failure);
    }
    setBusy(false);
  };

  const handlePause = () =>
    roomAction("pause", setIsPausing, "Impossibile mettere in pausa l'allenamento. Riprova.", () => navigate("/"));
  const handleResume = () =>
    roomAction("resume", setIsResuming, "Impossibile riprendere l'allenamento. Riprova.", refetchGameState);
  const handleResumeControl = () =>
    roomAction("resume-control", setIsResuming, "Impossibile riprendere il controllo. Riprova.", refetchGameState);

  const gameActions =
    !result && gameStatus !== "paused" ? (
      <GameActions
        isPausing={isPausing}
        isLeaving={isReturningHome}
        onPause={gameState?.isPractice ? () => void handlePause() : undefined}
        onLeave={() => void handleReturnHome()}
      />
    ) : null;

  if (authError) {
    return <AuthErrorState onRetry={retryAuth} />;
  }

  if (authLoading || (!gameState && !loadError)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-secondary/30 to-accent/20 flex items-center justify-center">
        <Card className="bg-card/80 backdrop-blur-sm p-8">
          <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground text-lg">
            Caricamento partita...
          </p>
        </Card>
      </div>
    );
  }

  if (!gameState) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-secondary/30 to-accent/20 flex items-center justify-center">
        <Card className="bg-card/80 backdrop-blur-sm p-8 text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <p className="text-lg font-medium">
            Impossibile caricare lo stato della partita
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => void refetchGameState()}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Riprova
          </Button>
        </Card>
      </div>
    );
  }

  if (!myPlayer) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-secondary/30 to-accent/20 flex items-center justify-center">
        <Card className="bg-card/80 backdrop-blur-sm p-8">
          <p className="text-destructive text-lg">Partita non trovata</p>
        </Card>
      </div>
    );
  }

  if (result && !completedTrick) {
    return (
      <GameResult
        result={result}
        myTeam={myPlayer.team}
        onHome={handleReturnHome}
        isReturningHome={isReturningHome}
      />
    );
  }

  return (
    <div
      className="arcade-game-page circolo-shell relative overflow-hidden"
      data-testid="game-table-page"
      data-current-turn-userid={currentTurnUserId ?? ""}
      data-briscola={round?.briscola ?? ""}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(157_42%_25%_/_0.11),transparent_58%)]" />

      {/* Connection Status Banner */}
      <ConnectionBanner status={connectionStatus} />

      <GameScoreHeader
        roomCode={gameRoomCode}
        briscola={round?.briscola}
        roundNumber={round?.number}
        trickNumber={completedTrick?.trickNumber ?? gameState.trick?.number ?? null}
        playerTeam={myPlayer.team}
        totalPoints={gameState.score}
      />

      <GameBoard
        players={playersWithPositions}
        currentTurnUserId={currentTurnUserId}
        currentSignal={currentSignal}
        notice={myBotControlled ? "Un bot gioca al tuo posto. Premi Riprendi controllo per tornare a giocare." : notice}
        countdown={deal.phase === "ready" ? countdown : null}
        playedCards={playedCards}
        animatedCard={animatedCard}
        completedTrick={completedTrick}
        fastCollection={fastCollection}
        briscola={round?.briscola}
        callerUserId={round?.callerUserId ?? null}
        currentUserId={userId}
        hand={completedTrick && completedTrick.roundNumber !== round?.number ? [] : myHand}
        playableCards={myBotControlled || isPlayingCard ? [] : playableCards}
        onCardClick={(card) => void handleCardClick(card)}
        deal={deal}
      >
        <div key="table-tools" className="arcade-game-tools relative flex flex-wrap justify-end gap-2 self-end">
          <GameChat
            roomCode={gameRoomCode ?? ""}
            userId={userId}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setLastTrickDialogOpen(true)}
          >
            <History className="h-4 w-4" aria-hidden="true" />
            Ultima presa
          </Button>
          {myBotControlled && !result && (
            <Button size="sm" disabled={isResuming} onClick={() => void handleResumeControl()}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Riprendi controllo
            </Button>
          )}
          {!myBotControlled && round?.briscola === null && round.callerUserId === userId && (
            <Button
              variant="default"
              size="sm"
              disabled
              title="La scelta si apre appena le carte sono pronte"
              data-testid="choose-trump-button"
            >
              <Crown className="h-4 w-4" aria-hidden="true" />
              Scegli la briscola
            </Button>
          )}
          {!trumpDialogOpen && gameActions}
        </div>
      </GameBoard>

      {/* Dialogs */}
      <SignalDialog
        disabled={isPlayingCard}
        open={signalDialogOpen}
        onOpenChange={(open) => {
          if (!open) setPendingCard(null);
        }}
        onSelect={handleSignalSelect}
      />
      <TrumpSuitDialog
        disabled={isChoosingTrump}
        open={trumpDialogOpen}
        onSelectSuit={handleTrumpSelect}
        myCards={myHand}
        actions={gameActions}
      />
      <PausedPracticeDialog
        open={gameStatus === "paused"}
        confirmAbandon={confirmPausedAbandon}
        isLeaving={isReturningHome}
        isResuming={isResuming}
        onCancelAbandon={() => setConfirmPausedAbandon(false)}
        onConfirmAbandon={() => void handleReturnHome()}
        onRequestAbandon={() => setConfirmPausedAbandon(true)}
        onResume={() => void handleResume()}
      />
      <LastTrickDialog
        open={lastTrickDialogOpen}
        onOpenChange={setLastTrickDialogOpen}
        lastHand={gameState.lastTrick?.cards ?? []}
        players={playersWithPositions}
        userId={userId}
      />
      {roundSummary && (
        <RoundEndDialog
          open={showRoundSummary}
          result={roundSummary}
          totalPoints={gameState.score}
          myTeam={myPlayer.team}
          callerName={gameState.players.find((player) => player.userId === round?.callerUserId)?.username ?? "Giocatore"}
          practiceActions={gameActions}
        />
      )}
    </div>
  );
};

export default GameTable;
