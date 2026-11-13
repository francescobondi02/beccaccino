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
import { subscribeToRoomEvent } from "@/sockets/roomHandlers";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useGameTable } from "@/hooks/useGameTable";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { useTurnCountdown } from "@/hooks/useTurnCountdown";
import { useRoundDeal } from "@/hooks/useRoundDeal";
import type { PlayerCard, Signal } from "@/game/model";
import { positionPlayers } from "@/game/presentation";
import {
  normalizeRoom,
  type Room,
  type RoomResponse,
} from "@/rooms/model";

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
  const [room, setRoom] = useState<Room | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const myPlayer =
    room?.players.find((player) => player.userId === userId) ?? null;

  const {
    currentRound,
    roundDeal,
    callerUserId,
    myCards,
    currentTurnUserId,
    playedCards,
    animatedCard,
    completedTrick,
    fastCollection,
    playableCards,
    lastHand,
    currentHandNumber,
    totalPoints,
    turnTimer,
    currentSignal,
    notice,
    playerControls = [],
    isPractice,
    roundEndData,
    gameFinishedData,
    gameStatus,
    gameStateStatus,
    refetchGameState,
    setRequestsEnabled,
    applyLocalBriscola,
  } = useGameTable(gameRoomCode, userId, room?.players ?? []);
  const connectionStatus = useConnectionStatus();
  const countdown = useTurnCountdown(turnTimer);
  const deal = useRoundDeal(
    roundDeal,
    !completedTrick && gameStatus === "choosing_briscola" && currentRound?.briscola === null,
  );
  const showRoundSummary = Boolean(roundEndData) && deal.phase === "collecting";
  const myControl = playerControls.find((player) => player.userId === userId);
  const myBotControlled = Boolean(myControl?.botModel);

  const [lastTrickDialogOpen, setLastTrickDialogOpen] = useState(false);
  const [isReturningHome, setIsReturningHome] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [confirmPausedAbandon, setConfirmPausedAbandon] = useState(false);

  // Leader card waiting for a signal choice
  const [pendingCard, setPendingCard] = useState<PlayerCard | null>(null);
  const [isPlayingCard, setIsPlayingCard] = useState(false);
  const signalDialogOpen = pendingCard !== null && !isPlayingCard;
  const [isChoosingTrump, setIsChoosingTrump] = useState(false);

  const cleanupRoom = useCallback(async (): Promise<void> => {
    if (!room || (!room.isPractice && gameFinishedData) || !gameRoomCode) return;

    try {
      await apiPost(`/rooms/${gameRoomCode}/leave`, {});
    } catch (error) {
      if (room.isPractice && error instanceof ApiError && error.status === 404) return;
      throw error;
    }
  }, [gameRoomCode, room, gameFinishedData]);

  useEffect(() => {
    if (myControl?.abandonedAt && !gameFinishedData) {
      setRequestsEnabled(false);
      navigate("/");
    }
    if (myBotControlled) setPendingCard(null);
  }, [myControl?.abandonedAt, myBotControlled, gameFinishedData, navigate, setRequestsEnabled]);

  // Carica i dati della stanza
  useEffect(() => {
    if (!userId || !gameRoomCode) return;

    const fetchRoom = async () => {
      setIsLoading(true);
      try {
        const roomData = await apiGet<RoomResponse>(`/rooms/${gameRoomCode}`);

        // Verifica che la partita sia iniziata
        if (!roomData.started) {
          toast.error("La partita non è ancora iniziata");
          navigate(`/room/${gameRoomCode}`);
          return;
        }

        const normalizedRoom = normalizeRoom(roomData);
        setRoom(normalizedRoom);
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.status === 404) {
            toast.error("Stanza non trovata");
          } else if (error.status === 403) {
            toast.error("Non sei un giocatore in questa stanza");
          } else {
            toast.error("Errore nel caricamento della stanza");
          }
        } else {
          console.error("Error fetching room:", error);
          toast.error("Impossibile caricare i dati della stanza");
        }
        navigate("/");
      } finally {
        setIsLoading(false);
      }
    };

    fetchRoom();
  }, [userId, gameRoomCode, navigate]);

  // Un giocatore che abbandona sparisce dalla stanza
  useEffect(() => {
    return subscribeToRoomEvent("player_left", ({ userId: leftUserId }) => {
      toast.warning("Un giocatore ha abbandonato la partita");
      setRoom((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          players: prev.players.filter((p) => p.userId !== leftUserId),
        };
      });
    });
  }, []);

  useEffect(() => {
    return subscribeToRoomEvent(
      "practice_abandoned",
      ({ roomCode: abandonedRoomCode }) => {
        if (abandonedRoomCode !== gameRoomCode) return;
        toast.info("L'allenamento è stato abbandonato");
        navigate("/");
      },
    );
  }, [gameRoomCode, navigate]);

  // Il caller vede il dialog briscola (non chiudibile) finché non sceglie.
  const trumpDialogOpen =
    gameStatus !== "paused" &&
    !myBotControlled &&
    !completedTrick &&
    deal.phase === "ready" &&
    myCards.length > 0 &&
    currentRound?.briscola === null &&
    callerUserId === userId &&
    !showRoundSummary &&
    !gameFinishedData;

  useEffect(() => {
    if (gameStatus === "paused") setPendingCard(null);
    else setConfirmPausedAbandon(false);
  }, [gameStatus]);

  useEffect(() => {
    if (pendingCard && (
      currentTurnUserId !== userId ||
      playedCards.length > 0 ||
      !myCards.some((card) => card.id === pendingCard.id && card.inHand)
    )) {
      setPendingCard(null);
    }
  }, [pendingCard, currentTurnUserId, userId, playedCards.length, myCards]);

  const playersWithPositions = positionPlayers(
    (room?.players ?? []).map((player) => ({
      ...player,
      ...playerControls.find((control) => control.userId === player.userId),
    })),
    userId,
  );

  const sendPlayCard = async (
    card: PlayerCard,
    signal?: Signal | null,
  ) => {
    setIsPlayingCard(true);
    try {
      await apiPost(`/games/play-card`, {
        roomCode: gameRoomCode,
        suit: card.suit,
        value: card.value,
        signal: signal || null,
      });
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
  const handleCardClick = async (card: PlayerCard) => {
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
    if (!myPlayer || !room || isChoosingTrump) return;
    setIsChoosingTrump(true);
    try {
      await apiPost(`/games/choose-briscola`, {
        gameRoomId: room.id,
        suit,
      });
      applyLocalBriscola(suit);
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
    setRequestsEnabled(false);
    try {
      await cleanupRoom();
      navigate("/");
    } catch (error) {
      console.error("Error leaving game:", error);
      toast.error("Impossibile abbandonare la partita. Riprova.");
      setIsReturningHome(false);
      setRequestsEnabled(true);
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
    !gameFinishedData && gameStatus !== "paused" ? (
      <GameActions
        isPausing={isPausing}
        isLeaving={isReturningHome}
        onPause={isPractice ? () => void handlePause() : undefined}
        onLeave={() => void handleReturnHome()}
      />
    ) : null;

  if (authError) {
    return <AuthErrorState onRetry={retryAuth} />;
  }

  if (authLoading || isLoading || gameStateStatus === "loading") {
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

  if (gameStateStatus === "error") {
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

  if (!room || !myPlayer) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-secondary/30 to-accent/20 flex items-center justify-center">
        <Card className="bg-card/80 backdrop-blur-sm p-8">
          <p className="text-destructive text-lg">Partita non trovata</p>
        </Card>
      </div>
    );
  }

  if (gameFinishedData && !completedTrick) {
    return (
      <GameResult
        result={gameFinishedData}
        players={room.players}
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
      data-briscola={currentRound?.briscola ?? ""}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(157_42%_25%_/_0.11),transparent_58%)]" />

      {/* Connection Status Banner */}
      <ConnectionBanner status={connectionStatus} />

      <GameScoreHeader
        roomCode={gameRoomCode}
        briscola={currentRound?.briscola}
        roundNumber={currentRound?.number}
        handNumber={currentHandNumber}
        playerTeam={myPlayer.team}
        totalPoints={totalPoints}
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
        briscola={currentRound?.briscola}
        callerUserId={callerUserId}
        currentUserId={userId}
        hand={completedTrick && completedTrick.roundId !== currentRound?.id ? [] : myCards}
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
          {myBotControlled && !gameFinishedData && (
            <Button size="sm" disabled={isResuming} onClick={() => void handleResumeControl()}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Riprendi controllo
            </Button>
          )}
          {!myBotControlled && currentRound?.briscola === null && callerUserId === userId && (
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
        myCards={myCards}
        practiceActions={gameActions}
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
        lastHand={lastHand}
        players={playersWithPositions}
        userId={userId}
      />
      {roundEndData && (
        <RoundEndDialog
          open={showRoundSummary}
          result={roundEndData}
          totalPoints={totalPoints}
          myTeam={myPlayer?.team ?? null}
          callerName={room.players.find((player) => player.userId === callerUserId)?.username ?? "Giocatore"}
          practiceActions={gameActions}
        />
      )}
    </div>
  );
};

export default GameTable;
