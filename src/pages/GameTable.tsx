import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import PlayingCard from "@/components/PlayingCard";
import TrumpSuitDialog from "@/components/TrumpSuitDialog";
import LastTrickDialog from "@/components/LastTrickDialog";
import RoundEndDialog from "@/components/RoundEndDialog";
import GameFinishedDialog from "@/components/GameFinishedDialog";
import GameChat from "@/components/GameChat";
import SignalDialog from "@/components/SignalDialog";
import ConnectionBanner from "@/components/ConnectionBanner";
import PlayerSeat from "@/components/PlayerSeat";
import TableCenter from "@/components/TableCenter";
import PracticePanel from "@/components/PracticePanel";
import AuthErrorState from "@/components/AuthErrorState";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { subscribeToRoomEvent } from "@/sockets/roomHandlers";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useGameTable } from "@/hooks/useGameTable";
import { useConnectionStatus } from "@/hooks/useConnectionStatus";
import type { PlayerCard, PlayerPosition, Signal } from "@/game/model";
import {
  normalizeRoom,
  type Room,
  type RoomPlayer,
  type RoomResponse,
} from "@/rooms/model";

interface PositionedPlayer extends RoomPlayer {
  position?: PlayerPosition;
  isLocalPlayer?: boolean;
  isTeammate?: boolean;
}

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
  const [myPlayer, setMyPlayer] = useState<RoomPlayer | null>(null);

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
    allHands,
    moveLog,
    roundEndData,
    gameFinishedData,
    gameStateStatus,
    refetchGameState,
    dismissRoundEnd,
    applyLocalBriscola,
  } = useGameTable(gameRoomCode, userId, username, room?.players ?? []);
  const connectionStatus = useConnectionStatus(refetchGameState);

  // Dialog state
  const [trumpDialogOpen, setTrumpDialogOpen] = useState(false);
  const [lastTrickDialogOpen, setLastTrickDialogOpen] = useState(false);
  const [roundEndDialogOpen, setRoundEndDialogOpen] = useState(false);
  const [gameFinishedDialogOpen, setGameFinishedDialogOpen] = useState(false);

  // Signal dialog state (pending card waiting for signal choice)
  const [pendingCard, setPendingCard] = useState<PlayerCard | null>(null);
  const [signalDialogOpen, setSignalDialogOpen] = useState(false);

  const [countdown, setCountdown] = useState<number | null>(null);
  const [isPlayingCard, setIsPlayingCard] = useState(false);
  const [handsRevealed, setHandsRevealed] = useState(false);

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

        const me = normalizedRoom.players.find((p) => p.userId === userId);
        setMyPlayer(me || null);
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

  // Il caller vede il dialog briscola finché non sceglie (il dialog non è
  // chiudibile in altro modo, quindi ri-aprirlo a ogni cambio di stato è
  // equivalente al vecchio open-on-fetch).
  useEffect(() => {
    if (currentRound?.briscola === null && callerUserId === userId) {
      setTrumpDialogOpen(true);
    }
  }, [currentRound?.briscola, callerUserId, userId]);

  useEffect(() => {
    if (roundEndData) {
      setRoundEndDialogOpen(true);
    }
  }, [roundEndData]);

  useEffect(() => {
    if (gameFinishedData) {
      setGameFinishedDialogOpen(true);
      setRoundEndDialogOpen(false);
      setTrumpDialogOpen(false);
    }
  }, [gameFinishedData]);

  // Countdown timer interval. totalMs is null on bot turns — no deadline,
  // so no countdown.
  useEffect(() => {
    if (!turnTimer || turnTimer.totalMs === null) {
      setCountdown(null);
      return;
    }
    const totalMs = turnTimer.totalMs;

    const tick = () => {
      const elapsed = Date.now() - turnTimer.startedAt;
      const remaining = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
      setCountdown(remaining);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [turnTimer]);

  // Calcola le posizioni relative dei giocatori
  const getPlayersWithPositions = (): PositionedPlayer[] => {
    if (!room || !myPlayer) return [];

    // Ordina i giocatori per seat
    const sortedPlayers = [...room.players].sort((a, b) => {
      if (a.seat === null) return 1;
      if (b.seat === null) return -1;
      return a.seat - b.seat;
    });

    // Trova l'indice del giocatore corrente
    const myIndex = sortedPlayers.findIndex((p) => p.userId === userId);
    if (myIndex === -1) return [];

    // Mappa delle posizioni relative
    const positionMap: Record<number, PlayerPosition> = {
      0: "bottom",
      1: "left",
      2: "top",
      3: "right",
    };

    // Assegna le posizioni relative
    return sortedPlayers.map((player, index) => {
      const relativeIndex = (index - myIndex + 4) % 4;
      return {
        ...player,
        position: positionMap[relativeIndex],
        isLocalPlayer: player.userId === userId,
        isTeammate: player.team === myPlayer.team && player.userId !== userId,
      };
    });
  };

  const playersWithPositions = getPlayersWithPositions();

  // Calcola i punti per squadra
  const myTeamPoints =
    myPlayer?.team === 0
      ? totalPoints.team0Points
      : totalPoints.team1Points;

  const opponentTeamPoints =
    myPlayer?.team === 0
      ? totalPoints.team1Points
      : totalPoints.team0Points;

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
      toast.success(`Briscola scelta: ${suit}`);
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.body?.error || "Errore nella scelta della briscola");
      } else {
        console.error("Error choosing briscola:", error);
        toast.error("Errore nella scelta della briscola");
      }
    }
  };

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
      className="min-h-screen bg-gradient-to-br from-background via-secondary/30 to-accent/20 relative overflow-hidden"
      data-testid="game-table-page"
      data-current-turn-userid={currentTurnUserId ?? ""}
      data-briscola={currentRound?.briscola ?? ""}
      data-game-finished={gameFinishedDialogOpen}
    >
      {/* Background decorative elements */}
      <div className="absolute inset-0 bg-gradient-warm opacity-20 pointer-events-none" />

      {/* Connection Status Banner */}
      <ConnectionBanner status={connectionStatus} />

      <div className="absolute top-4 right-4 text-sm text-muted-foreground">
        Room:{" "}
        <span className="font-semibold text-foreground">{gameRoomCode}</span>
      </div>

      {/* Briscola Badge */}
      {currentRound?.briscola && (
        <Card className="absolute top-4 left-4 px-4 py-3 shadow-lg border-2 bg-card/80 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <img
              src={`/images/semi/${currentRound.briscola}_seme.png`}
              alt={currentRound.briscola}
              className="w-8 h-8 object-contain"
            />
            <div>
              <div className="text-xs text-muted-foreground">Briscola</div>
              <div className="text-sm font-bold capitalize">
                {currentRound.briscola}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Team Points Panel */}
      <Card className="absolute top-4 left-1/2 -translate-x-1/2 px-6 py-3 shadow-lg border-2 bg-card/80 backdrop-blur-sm" data-testid="team-points-panel">
        {currentHandNumber && currentRound && (
          <div className="text-center text-xs text-muted-foreground mb-2 border-b border-border pb-1">
            Round {currentRound.number} &middot; Mano {currentHandNumber}/10
          </div>
        )}
        <div className="flex items-center gap-6">
          <div className="text-center">
            <div className="text-xs text-muted-foreground mb-1">
              La tua squadra (Team {(myPlayer.team ?? 0) + 1})
            </div>
            <div className="text-2xl font-bold text-primary" data-testid="my-team-points">
              {myTeamPoints}
            </div>
          </div>
          <div className="h-8 w-px bg-border" />
          <div className="text-center">
            <div className="text-xs text-muted-foreground mb-1">
              Avversari (Team {((myPlayer.team ?? 0) === 0 ? 1 : 0) + 1})
            </div>
            <div className="text-2xl font-bold text-accent" data-testid="opponent-team-points">
              {opponentTeamPoints}
            </div>
          </div>
        </div>
      </Card>

      {/* Main game area */}
      <div className="container mx-auto h-screen flex flex-col justify-between items-center py-20 px-4">
        {/* Top Player */}
        <div className="flex flex-col items-center gap-2">
          {playersWithPositions
            .filter((p) => p.position === "top")
            .map((player) => (
              <PlayerSeat
                key={player.id}
                testId="player-seat-top"
                player={player}
                isTurn={currentTurnUserId === player.userId}
                showRole
                countdown={countdown}
                signal={
                  currentSignal?.userId === player.userId
                    ? currentSignal.signal
                    : null
                }
              />
            ))}
        </div>

        {/* Central Table Area */}
        <div className="flex-1 flex items-center justify-center w-full max-w-4xl">
          <div className="relative w-full h-full max-h-96 flex items-center justify-center">
            {/* Left Player */}
            <div className="absolute left-0 top-1/2 -translate-y-1/2">
              {playersWithPositions
                .filter((p) => p.position === "left")
                .map((player) => (
                  <PlayerSeat
                    key={player.id}
                    player={player}
                    isTurn={currentTurnUserId === player.userId}
                    showRole
                    signal={
                      currentSignal?.userId === player.userId
                        ? currentSignal.signal
                        : null
                    }
                  />
                ))}
            </div>

            {/* Right Player */}
            <div className="absolute right-0 top-1/2 -translate-y-1/2">
              {playersWithPositions
                .filter((p) => p.position === "right")
                .map((player) => (
                  <PlayerSeat
                    key={player.id}
                    player={player}
                    isTurn={currentTurnUserId === player.userId}
                    showRole
                    signal={
                      currentSignal?.userId === player.userId
                        ? currentSignal.signal
                        : null
                    }
                  />
                ))}
            </div>

            {/* Central Table with Played Cards */}
            <TableCenter
              cards={playedCards.map((playedCard) => ({
                userId: playedCard.userId,
                suit: playedCard.suit,
                value: playedCard.value,
                position:
                  playersWithPositions.find(
                    (p) => p.userId === playedCard.userId,
                  )?.position ?? "bottom",
              }))}
              briscolaChosen={currentRound?.briscola !== null}
              waitingForUsername={
                playersWithPositions.find(
                  (p) => p.userId === currentTurnUserId,
                )?.username ?? "giocatore"
              }
              countdown={countdown}
            />
          </div>
        </div>

        {/* Bottom: Local Player Info + Hand */}
        <div className="flex flex-col items-center gap-4 w-full">
          {/* Player's Hand */}
          <div className="flex gap-2 flex-wrap justify-center max-w-5xl" data-testid="player-hand">
            {myCards
              .filter((c) => c.inHand)
              .map((card) => {
                const isPlayable = playableCards.some(
                  (pc) => pc.suit === card.suit && pc.value === card.value,
                );
                const isMyTurn = currentTurnUserId === userId;

                return (
                  <PlayingCard
                    key={card.id}
                    suit={card.suit}
                    value={card.value}
                    onClick={() => handleCardClick(card)}
                    size="lg"
                    clickable={isMyTurn && isPlayable}
                    disabled={!isMyTurn || !isPlayable}
                    data-testid={`hand-card-${card.suit}-${card.value}`}
                  />
                );
              })}
          </div>

          {/* Local Player Info */}
          {playersWithPositions
            .filter((p) => p.position === "bottom")
            .map((player) => (
              <PlayerSeat
                key={player.id}
                testId="player-seat-bottom"
                player={player}
                isTurn={currentTurnUserId === player.userId}
              />
            ))}
        </div>
      </div>

      {/* Practice diagnostics — a fixed side rail, hidden below xl so it never
          squeezes the table on a narrow screen. */}
      {isPractice && (
        <div
          className="hidden xl:block fixed right-4 top-20 w-72 z-30"
          data-testid="practice-panel"
        >
          <PracticePanel
            moveLog={moveLog}
            hands={allHands}
            revealed={handsRevealed}
            onToggleReveal={() => setHandsRevealed((prev) => !prev)}
            usernameOf={(id) =>
              room?.players.find((p) => p.userId === id)?.username ?? `#${id}`
            }
          />
        </div>
      )}

      {/* Game Action Buttons */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2">
        <GameChat
          roomCode={gameRoomCode ?? ""}
          userId={userId}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setLastTrickDialogOpen(true)}
        >
          Ultima Mano
        </Button>
        {currentRound?.briscola === null && callerUserId === userId && (
          <Button
            variant="default"
            size="sm"
            onClick={() => setTrumpDialogOpen(true)}
            data-testid="choose-trump-button"
          >
            Scegli Briscola
          </Button>
        )}
      </div>

      {/* Dialogs */}
      <SignalDialog
        open={signalDialogOpen}
        onSelect={handleSignalSelect}
      />
      <TrumpSuitDialog
        open={trumpDialogOpen}
        onSelectSuit={handleTrumpSelect}
        myCards={myCards}
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
        />
      )}
    </div>
  );
};

export default GameTable;
