import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import TrumpSuitDialog from "@/components/TrumpSuitDialog";
import LastTrickDialog from "@/components/LastTrickDialog";
import RoundEndDialog from "@/components/RoundEndDialog";
import GameFinishedDialog from "@/components/GameFinishedDialog";
import GameChat from "@/components/GameChat";
import SignalDialog from "@/components/SignalDialog";
import ConnectionBanner from "@/components/ConnectionBanner";
import AuthErrorState from "@/components/AuthErrorState";
import GameBoard from "@/components/game/GameBoard";
import GameScoreHeader from "@/components/game/GameScoreHeader";
import PausedPracticeDialog from "@/components/game/PausedPracticeDialog";
import PracticeActions from "@/components/game/PracticeActions";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { subscribeToRoomEvent } from "@/sockets/roomHandlers";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useGameTable } from "@/hooks/useGameTable";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import { useTurnCountdown } from "@/hooks/useTurnCountdown";
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
  const username = user?.username ?? "";
  const [room, setRoom] = useState<Room | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const myPlayer =
    room?.players.find((player) => player.userId === userId) ?? null;

  const {
    currentRound,
    callerUserId,
    myCards,
    currentTurnUserId,
    playedCards,
    playableCards,
    lastHand,
    currentHandNumber,
    totalPoints,
    turnTimer,
    currentSignal,
    isPractice,
    roundEndData,
    gameFinishedData,
    gameStatus,
    gameStateStatus,
    refetchGameState,
    setRequestsEnabled,
    dismissRoundEnd,
    applyLocalBriscola,
  } = useGameTable(gameRoomCode, userId, username, room?.players ?? []);
  const connectionStatus = useConnectionStatus();
  const countdown = useTurnCountdown(turnTimer);

  // Dialog state
  const [trumpDialogOpen, setTrumpDialogOpen] = useState(false);
  const [lastTrickDialogOpen, setLastTrickDialogOpen] = useState(false);
  const [roundEndDialogOpen, setRoundEndDialogOpen] = useState(false);
  const [gameFinishedDialogOpen, setGameFinishedDialogOpen] = useState(false);
  const [isReturningHome, setIsReturningHome] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [confirmPausedAbandon, setConfirmPausedAbandon] = useState(false);

  // Signal dialog state (pending card waiting for signal choice)
  const [pendingCard, setPendingCard] = useState<PlayerCard | null>(null);
  const [signalDialogOpen, setSignalDialogOpen] = useState(false);

  const [isPlayingCard, setIsPlayingCard] = useState(false);

  const cleanupPracticeRoom = useCallback(async (): Promise<void> => {
    if (!room?.isPractice || !gameRoomCode) return;

    try {
      await apiPost(`/rooms/${gameRoomCode}/leave`, {});
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return;
      throw error;
    }
  }, [gameRoomCode, room?.isPractice]);

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

  // Il caller vede il dialog briscola finché non sceglie (il dialog non è
  // chiudibile in altro modo, quindi ri-aprirlo a ogni cambio di stato è
  // equivalente al vecchio open-on-fetch).
  useEffect(() => {
    setTrumpDialogOpen(
      gameStatus !== "paused" &&
      currentRound?.briscola === null &&
        callerUserId === userId &&
        !roundEndData &&
        !gameFinishedData,
    );
  }, [
    currentRound?.briscola,
    callerUserId,
    userId,
    gameStatus,
    roundEndData,
    gameFinishedData,
  ]);

  useEffect(() => {
    if (gameStatus === "paused") {
      setTrumpDialogOpen(false);
      setSignalDialogOpen(false);
      setPendingCard(null);
      return;
    }
    setConfirmPausedAbandon(false);
  }, [gameStatus]);

  useEffect(() => {
    setRoundEndDialogOpen(Boolean(roundEndData));
  }, [roundEndData]);

  useEffect(() => {
    if (gameFinishedData) {
      setGameFinishedDialogOpen(true);
      setRoundEndDialogOpen(false);
      setTrumpDialogOpen(false);
    }
  }, [gameFinishedData]);

  const playersWithPositions = positionPlayers(room?.players ?? [], userId);

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
      setIsPlayingCard(false);
    }
  };

  const handleCardClick = async (card: PlayerCard) => {
    if (!gameRoomCode || currentTurnUserId !== userId) {
      toast.error("Non è il tuo turno!");
      return;
    }

    if (isPlayingCard) return;

    const isPlayable = playableCards.some(
      (c) => c.suit === card.suit && c.value === card.value,
    );
    if (!isPlayable) {
      toast.error("Non puoi giocare questa carta!");
      return;
    }

    // If trick leader (no cards on table), show signal dialog
    if (playedCards.length === 0) {
      setPendingCard(card);
      setSignalDialogOpen(true);
      return;
    }

    // Not trick leader — play immediately
    await sendPlayCard(card);
  };

  const handleSignalSelect = async (signal: Signal | null) => {
    setSignalDialogOpen(false);
    if (pendingCard) {
      await sendPlayCard(pendingCard, signal);
      setPendingCard(null);
    }
  };

  const handleTrumpSelect = async (suit: string) => {
    if (!myPlayer || !room) return;
    try {
      await apiPost(`/games/choose-briscola`, {
        gameRoomId: room.id,
        suit,
      });
      applyLocalBriscola(suit);
      setTrumpDialogOpen(false);
      toast.success(`Briscola scelta: ${suit === "denara" ? "denari" : suit}`);
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.body?.error || "Errore nella scelta della briscola");
      } else {
        console.error("Error choosing briscola:", error);
        toast.error("Errore nella scelta della briscola");
      }
    }
  };

  // Shared by the end-of-game dialog and the practice abandon button: both mean
  // "go home, tearing down the practice room first if this is one".
  const handleReturnHome = async () => {
    setIsReturningHome(true);
    setRequestsEnabled(false);
    try {
      await cleanupPracticeRoom();
      navigate("/");
    } catch (error) {
      console.error("Error cleaning up practice room:", error);
      toast.error("Impossibile chiudere la partita di pratica. Riprova.");
      setIsReturningHome(false);
      setRequestsEnabled(true);
    }
  };

  const handlePause = async () => {
    if (!gameRoomCode) return;

    setIsPausing(true);
    try {
      await apiPost<{ success: boolean; paused: boolean }>(
        `/rooms/${gameRoomCode}/pause`,
        {},
      );
      navigate("/");
    } catch (error) {
      console.error("Error pausing practice room:", error);
      toast.error("Impossibile mettere in pausa l'allenamento. Riprova.");
      setIsPausing(false);
    }
  };

  const handleResume = async () => {
    if (!gameRoomCode) return;

    setIsResuming(true);
    try {
      await apiPost<{ success: boolean; paused: boolean }>(
        `/rooms/${gameRoomCode}/resume`,
        {},
      );
      await refetchGameState();
    } catch (error) {
      console.error("Error resuming practice room:", error);
      toast.error("Impossibile riprendere l'allenamento. Riprova.");
    } finally {
      setIsResuming(false);
    }
  };

  const practiceActions =
    isPractice && !gameFinishedData && gameStatus !== "paused" ? (
      <PracticeActions
        isPausing={isPausing}
        isLeaving={isReturningHome}
        onPause={() => void handlePause()}
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

  return (
    <div
      className="circolo-shell relative overflow-hidden"
      data-testid="game-table-page"
      data-current-turn-userid={currentTurnUserId ?? ""}
      data-briscola={currentRound?.briscola ?? ""}
      data-game-finished={gameFinishedDialogOpen}
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
        countdown={countdown}
        playedCards={playedCards}
        briscola={currentRound?.briscola}
        callerUserId={callerUserId}
        currentUserId={userId}
        hand={myCards}
        playableCards={playableCards}
        onCardClick={(card) => void handleCardClick(card)}
      />

      {/* Game Action Buttons */}
      <div className="arcade-game-tools absolute bottom-4 right-4 flex flex-col gap-2">
        <GameChat
          roomCode={gameRoomCode ?? ""}
          userId={userId}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setLastTrickDialogOpen(true)}
        >
          Ultima presa
        </Button>
        {currentRound?.briscola === null && callerUserId === userId && (
          <Button
            variant="default"
            size="sm"
            onClick={() => setTrumpDialogOpen(true)}
            data-testid="choose-trump-button"
          >
            Scegli la briscola
          </Button>
        )}
        {!trumpDialogOpen && practiceActions}
      </div>

      {/* Dialogs */}
      <SignalDialog
        open={signalDialogOpen}
        onOpenChange={(open) => {
          setSignalDialogOpen(open);
          if (!open) setPendingCard(null);
        }}
        onSelect={handleSignalSelect}
      />
      <TrumpSuitDialog
        open={trumpDialogOpen}
        onSelectSuit={handleTrumpSelect}
        myCards={myCards}
        practiceActions={practiceActions}
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
          open={roundEndDialogOpen}
          onOpenChange={(open) => {
            setRoundEndDialogOpen(open);
            if (!open) {
              dismissRoundEnd();
            }
          }}
          roundNumber={roundEndData.roundNumber}
          team0Points={roundEndData.team0Points}
          team1Points={roundEndData.team1Points}
          winnerTeam={roundEndData.winnerTeam}
          myTeam={myPlayer?.team ?? null}
        />
      )}
      {gameFinishedData && (
        <GameFinishedDialog
          open={gameFinishedDialogOpen}
          winnerTeam={gameFinishedData.winnerTeam}
          totalRounds={gameFinishedData.totalRounds}
          finalScores={gameFinishedData.finalScores}
          roundsWon={gameFinishedData.roundsWon}
          myTeam={myPlayer?.team ?? null}
          onHome={handleReturnHome}
          isReturningHome={isReturningHome}
        />
      )}
    </div>
  );
};

export default GameTable;
