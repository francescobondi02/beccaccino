import { useState, useEffect, useCallback, useRef } from "react";
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
import SignalBadge from "@/components/SignalBadge";
import PracticePanel, { RevealedHand } from "@/components/PracticePanel";
import { MoveLogEntry } from "@/components/MoveLog";
import { Loader2, WifiOff, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  registerRoomHandlers,
  leaveRoom,
  onPlayerLeft,
  offPlayerLeft,
} from "@/sockets/roomHandlers";
import {
  getSocket,
  onConnectionStatusChange,
  getConnectionStatus,
  registerErrorToast,
} from "@/sockets/socketClient";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { normalizePlayer } from "@/lib/player";
import type {
  BriscolaChosenPayload,
  RoundEndedPayload,
  GameFinishedPayload,
  TurnTimerStartedPayload,
  AutoPlayedPayload,
  PlayerKickedTimeoutPayload,
  PlayerDisconnectedPayload,
} from "@/sockets/events";

type PlayerPosition = "bottom" | "top" | "left" | "right";

interface Player {
  id: number;
  userId: number;
  username: string;
  seat: number | null;
  team: number | null;
  isReady: boolean;
  position?: PlayerPosition;
  isLocalPlayer?: boolean;
  isTeammate?: boolean;
}

interface Room {
  id: number;
  code: string;
  started: boolean;
  finished: boolean;
  players: Player[];
}

interface PlayerCard {
  id: number;
  suit: string;
  value: string;
  playerId: number;
  roundId: number;
  inHand: boolean;
}

interface PlayedCardData {
  playerId: number;
  userId: number;
  suit: string;
  value: string;
  position: number;
  signal?: string | null;
  handNumber?: number;
}

// Shape of GET /games/:code/state (backend gameController.getGameState).
interface GameStateResponse {
  round: { id: number; number: number; briscola: string | null; cricca?: boolean };
  currentHandNumber: number | null;
  callerUserId: number | null;
  myCards: PlayerCard[];
  currentTurnUserId: number | null;
  playedCards: PlayedCardData[];
  lastHandCards: PlayedCardData[];
  totalPoints: {
    team0Points: number;
    team1Points: number;
    team0Figures: number;
    team1Figures: number;
  };
  turnTimer: {
    turnUserId: number;
    remainingMs: number;
    totalMs: number;
    phase: string;
  } | null;
  isPractice: boolean;
  allHands: RevealedHand[] | null;
}


const GameTable = () => {
  const { gameRoomCode } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth({ redirectOnFail: true });
  const userId = user?.id ?? null;
  const username = user?.username ?? "";
  const [room, setRoom] = useState<Room | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [myPlayer, setMyPlayer] = useState<Player | null>(null);
  const [trumpDialogOpen, setTrumpDialogOpen] = useState(false);
  const [lastTrickDialogOpen, setLastTrickDialogOpen] = useState(false);
  const [currentRound, setCurrentRound] = useState<{
    id: number;
    number: number;
    briscola: string | null;
  } | null>(null);
  const [callerUserId, setCallerUserId] = useState<number | null>(null);
  const [myCards, setMyCards] = useState<PlayerCard[]>([]);
  const [currentTurnUserId, setCurrentTurnUserId] = useState<number | null>(
    null,
  );
  const [playedCards, setPlayedCards] = useState<PlayedCardData[]>([]);
  const [playableCards, setPlayableCards] = useState<PlayerCard[]>([]);
  const [lastHand, setLastHand] = useState<PlayedCardData[]>([]);
  const [currentHandNumber, setCurrentHandNumber] = useState<number | null>(
    null,
  );
  const [roundEndDialogOpen, setRoundEndDialogOpen] = useState(false);
  const [roundEndData, setRoundEndData] = useState<{
    roundNumber: number;
    team0Points: number;
    team1Points: number;
    team0Figures: number;
    team1Figures: number;
    winnerTeam: number;
  } | null>(null);
  const [totalPoints, setTotalPoints] = useState<{
    team0Points: number;
    team1Points: number;
    team0Figures: number;
    team1Figures: number;
  }>({ team0Points: 0, team1Points: 0, team0Figures: 0, team1Figures: 0 });
  const [gameFinishedDialogOpen, setGameFinishedDialogOpen] = useState(false);
  const [gameFinishedData, setGameFinishedData] = useState<{
    winnerTeam: number;
    totalRounds: number;
    finalScores: {
      team0: number;
      team1: number;
    };
    roundsWon: {
      team0: number;
      team1: number;
    };
  } | null>(null);

  // Signal dialog state (pending card waiting for signal choice)
  const [pendingCard, setPendingCard] = useState<PlayerCard | null>(null);
  const [signalDialogOpen, setSignalDialogOpen] = useState(false);
  const [currentSignal, setCurrentSignal] = useState<{
    userId: number;
    signal: string;
  } | null>(null);

  // Turn timer state
  const [turnTimer, setTurnTimer] = useState<{
    turnUserId: number;
    totalMs: number;
    serverTimestamp: number;
    phase: string;
  } | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Connection status & play lock
  const [connectionStatus, setConnectionStatus] = useState<
    "connected" | "disconnected" | "reconnecting"
  >(getConnectionStatus());
  const [isPlayingCard, setIsPlayingCard] = useState(false);

  // Practice-game diagnostics: the move log and revealed hands only exist when
  // the SERVER says this is a practice room (see gameController.revealAllHands).
  const [isPractice, setIsPractice] = useState(false);
  const [allHands, setAllHands] = useState<RevealedHand[] | null>(null);
  const [handsRevealed, setHandsRevealed] = useState(false);
  const [moveLog, setMoveLog] = useState<MoveLogEntry[]>([]);

  // Refs for values needed in socket handlers without causing re-registration
  const userIdRef = useRef<number | null>(null);
  const gameRoomCodeRef = useRef<string | undefined>(undefined);
  const playersRef = useRef<Player[]>([]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    gameRoomCodeRef.current = gameRoomCode;
  }, [gameRoomCode]);

  useEffect(() => {
    playersRef.current = room?.players ?? [];
  }, [room]);

  /**
   * Record a played card in the diagnostic log.
   *
   * Reads players from a ref so the socket handlers that call it don't have to
   * re-register whenever the room object changes.
   */
  const appendToMoveLog = useCallback((data: PlayedCardData) => {
    const player = playersRef.current.find((p) => p.userId === data.userId);
    setMoveLog((prev) => [
      ...prev,
      {
        handNumber: data.handNumber ?? null,
        username: player?.username ?? `#${data.userId}`,
        suit: data.suit,
        value: data.value,
        signal: data.signal ?? null,
      },
    ]);
  }, []);

  // Carica i dati della stanza
  useEffect(() => {
    if (!userId || !gameRoomCode) return;

    const fetchRoom = async () => {
      setIsLoading(true);
      try {
        const roomData = await apiGet<Room>(`/rooms/${gameRoomCode}`);

        // Verifica che la partita sia iniziata
        if (!roomData.started) {
          toast.error("La partita non è ancora iniziata");
          navigate(`/room/${gameRoomCode}`);
          return;
        }

        // Normalizza i giocatori per compatibilità con l'interfaccia
        const players: Player[] = roomData.players.map(normalizePlayer);

        setRoom({ ...roomData, players });

        // Trova il player corrente
        const me = players.find((p) => p.userId === userId);
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

  // Carica stato del round (briscola, caller)
  useEffect(() => {
    if (!userId || !gameRoomCode) return;

    const fetchGameState = async () => {
      try {
        const data = await apiGet<GameStateResponse>(`/games/${gameRoomCode}/state`);
        setCurrentRound(data.round);
        setCallerUserId(data.callerUserId);
        setMyCards(data.myCards ?? []);
        setCurrentTurnUserId(data.currentTurnUserId ?? null);
        setPlayedCards(data.playedCards ?? []);
        setLastHand(data.lastHandCards ?? []);
        setCurrentHandNumber(data.currentHandNumber ?? null);
        setTotalPoints(
          data.totalPoints ?? {
            team0Points: 0,
            team1Points: 0,
            team0Figures: 0,
            team1Figures: 0,
          },
        );
        setIsPractice(data.isPractice ?? false);
        setAllHands(data.allHands ?? null);
        // Apri il dialog automaticamente se sono io il caller e briscola non è ancora scelta
        if (data.round.briscola === null && data.callerUserId === userId) {
          setTrumpDialogOpen(true);
        }
      } catch (error) {
        console.error("Error fetching game state:", error);
      }
    };

    fetchGameState();
  }, [userId, gameRoomCode]);

  // Fetch carte giocabili quando è il mio turno
  useEffect(() => {
    if (!userId || !gameRoomCode || currentTurnUserId !== userId) {
      setPlayableCards([]);
      return;
    }

    const fetchPlayableCards = async () => {
      try {
        const data = await apiGet<{ playableCards?: PlayerCard[] }>(
          `/games/playable-cards/${gameRoomCode}`,
        );
        setPlayableCards(data.playableCards ?? []);
      } catch (error) {
        console.error("Error fetching playable cards:", error);
      }
    };

    fetchPlayableCards();
  }, [currentTurnUserId, userId, gameRoomCode, currentRound?.briscola, playedCards.length, myCards.length]);

  // Helper: refetch full game state from backend
  const refetchGameState = useCallback(async () => {
    const uid = userIdRef.current;
    const code = gameRoomCodeRef.current;
    if (!uid || !code) return;

    try {
      const data = await apiGet<GameStateResponse>(`/games/${code}/state`);
      setCurrentRound(data.round);
      setCallerUserId(data.callerUserId);
      setMyCards(data.myCards ?? []);
      setCurrentTurnUserId(data.currentTurnUserId ?? null);
      setPlayedCards(data.playedCards ?? []);
      setLastHand(data.lastHandCards ?? []);
      setCurrentHandNumber(data.currentHandNumber ?? null);
      setTotalPoints(
        data.totalPoints ?? {
          team0Points: 0,
          team1Points: 0,
          team0Figures: 0,
          team1Figures: 0,
        },
      );

      setIsPractice(data.isPractice ?? false);
      setAllHands(data.allHands ?? null);

      // Se sono il caller e briscola non è ancora scelta, apri il dialog
      if (data.round?.briscola === null && data.callerUserId === uid) {
        setTrumpDialogOpen(true);
      }

      // Fetch playable cards immediately if it's our turn
      if (data.currentTurnUserId === uid && data.round?.briscola) {
        const pcData = await apiGet<{ playableCards?: PlayerCard[] }>(
          `/games/playable-cards/${code}`,
        );
        setPlayableCards(pcData.playableCards ?? []);
      }

      // Sync turn timer from server state (for reconnecting players)
      if (data.turnTimer) {
        setTurnTimer({
          turnUserId: data.turnTimer.turnUserId,
          totalMs: data.turnTimer.totalMs,
          serverTimestamp:
            Date.now() - (data.turnTimer.totalMs - data.turnTimer.remainingMs),
          phase: data.turnTimer.phase,
        });
      } else {
        setTurnTimer(null);
      }
    } catch (error) {
      console.error("Error refetching game state:", error);
    }
  }, []);

  // Gestione completamento mano (4 carte giocate) - refetch dopo 3 secondi
  useEffect(() => {
    if (playedCards.length !== 4) return;

    const timer = setTimeout(() => {
      refetchGameState();
    }, 3000);

    return () => clearTimeout(timer);
  }, [playedCards.length, refetchGameState]);

  // Countdown timer interval
  useEffect(() => {
    if (!turnTimer) {
      setCountdown(null);
      return;
    }

    const tick = () => {
      const elapsed = Date.now() - turnTimer.serverTimestamp;
      const remaining = Math.max(
        0,
        Math.ceil((turnTimer.totalMs - elapsed) / 1000),
      );
      setCountdown(remaining);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [turnTimer]);

  // Connection status tracking + refetch on reconnect
  useEffect(() => {
    const unsubscribe = onConnectionStatusChange((status) => {
      setConnectionStatus(status);

      // When socket reconnects, refetch state to catch any missed events
      if (status === "connected") {
        refetchGameState();
      }
    });

    return unsubscribe;
  }, [refetchGameState]);

  // Gestione WebSocket: mantieni la connessione alla room durante la partita
  // NOTE: Dependencies do NOT include `room` to avoid constant re-registration
  useEffect(() => {
    if (!userId || !username || !gameRoomCode) return;

    // Register room handlers (joins socket room, sets up reconnect auto-rejoin)
    registerRoomHandlers(gameRoomCode, { userId, username });

    const handlePlayerLeft = (leftUserId: number) => {
      toast.warning("Un giocatore ha abbandonato la partita");
      setRoom((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          players: prev.players.filter((p) => p.userId !== leftUserId),
        };
      });
    };

    onPlayerLeft(handlePlayerLeft);
    const unsubscribeErrorToast = registerErrorToast();

    const socket = getSocket();

    const handleCardPlayed = (data: PlayedCardData) => {
      // Clear countdown — new timer will arrive via turn_timer_started
      setTurnTimer(null);

      appendToMoveLog(data);

      // Track signal declaration (only on first card of a trick)
      if (data.signal) {
        setCurrentSignal({ userId: data.userId, signal: data.signal });
      } else if (data.position === 0) {
        // New trick started without signal — clear previous
        setCurrentSignal(null);
      }

      // If the card is mine, remove it from hand
      if (data.userId === userIdRef.current) {
        setMyCards((prev) =>
          prev.filter(
            (c) => !(c.suit === data.suit && c.value === data.value),
          ),
        );
      }

      // Optimistic update: add card to played cards
      setPlayedCards((prev) => {
        const next = [...prev, data];
        // Only refetch immediately if hand is NOT complete (< 4 cards).
        // For complete hands (4 cards), the dedicated 3-second timer handles
        // the refetch, giving the backend time to create the new hand.
        if (next.length < 4) {
          setTimeout(() => refetchGameState(), 300);
        }
        return next;
      });
    };

    const handleBriscolaChosen = (data: BriscolaChosenPayload) => {
      setTurnTimer(null);
      setCurrentRound((prev) => {
        if (!prev) return prev;
        return { ...prev, briscola: data.briscola };
      });
      // Refetch to get updated turn info
      setTimeout(() => refetchGameState(), 300);
    };

    const handleRoundEnded = (data: RoundEndedPayload) => {
      setRoundEndData({
        roundNumber: data.roundNumber,
        team0Points: data.team0.points,
        team1Points: data.team1.points,
        team0Figures: data.team0.figures,
        team1Figures: data.team1.figures,
        winnerTeam: data.winnerTeam,
      });
      setRoundEndDialogOpen(true);
    };

    const handleNewRoundStarted = () => {
      toast.success("Nuovo round iniziato!");
      refetchGameState();
    };

    const handleGameFinished = (data: GameFinishedPayload) => {
      setGameFinishedData(data);
      setGameFinishedDialogOpen(true);
      setRoundEndDialogOpen(false);
      setTrumpDialogOpen(false);
    };

    // Handler for opponent disconnect notification
    const handlePlayerDisconnected = (data: PlayerDisconnectedPayload) => {
      toast.warning(`${data.username} si è disconnesso`);
    };

    const handleTurnTimerStarted = (data: TurnTimerStartedPayload) => {
      setTurnTimer(data);
    };

    const handleAutoPlayed = (data: AutoPlayedPayload) => {
      const playerName =
        room?.players.find((p) => p.userId === data.userId)?.username ??
        "Giocatore";
      toast.info(`${playerName} ha giocato automaticamente (tempo scaduto)`);
    };

    const handlePlayerKickedTimeout = (data: PlayerKickedTimeoutPayload) => {
      toast.warning(`${data.username} è stato rimosso per inattività`);
    };

    socket.on("card_played", handleCardPlayed);
    socket.on("briscola_chosen", handleBriscolaChosen);
    socket.on("round_ended", handleRoundEnded);
    socket.on("new_round_started", handleNewRoundStarted);
    socket.on("game_finished", handleGameFinished);
    socket.on("player_disconnected", handlePlayerDisconnected);
    socket.on("turn_timer_started", handleTurnTimerStarted);
    socket.on("auto_played", handleAutoPlayed);
    socket.on("player_kicked_timeout", handlePlayerKickedTimeout);

    return () => {
      offPlayerLeft(handlePlayerLeft);
      unsubscribeErrorToast();
      socket.off("card_played", handleCardPlayed);
      socket.off("briscola_chosen", handleBriscolaChosen);
      socket.off("round_ended", handleRoundEnded);
      socket.off("new_round_started", handleNewRoundStarted);
      socket.off("game_finished", handleGameFinished);
      socket.off("player_disconnected", handlePlayerDisconnected);
      socket.off("turn_timer_started", handleTurnTimerStarted);
      socket.off("auto_played", handleAutoPlayed);
      socket.off("player_kicked_timeout", handlePlayerKickedTimeout);
    };
  }, [userId, username, gameRoomCode, refetchGameState]);

  // Calcola le posizioni relative dei giocatori
  const getPlayersWithPositions = (): Player[] => {
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
      ? { points: totalPoints.team0Points, figures: totalPoints.team0Figures }
      : { points: totalPoints.team1Points, figures: totalPoints.team1Figures };

  const opponentTeamPoints =
    myPlayer?.team === 0
      ? { points: totalPoints.team1Points, figures: totalPoints.team1Figures }
      : { points: totalPoints.team0Points, figures: totalPoints.team0Figures };

  const sendPlayCard = async (
    card: PlayerCard,
    signal?: "striscio" | "busso" | "volo" | null,
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

  const handleSignalSelect = async (
    signal: "striscio" | "busso" | "volo" | null,
  ) => {
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
      setCurrentRound((prev) => (prev ? { ...prev, briscola: suit } : prev));
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

  if (isLoading) {
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
      {connectionStatus !== "connected" && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-destructive/90 text-destructive-foreground px-4 py-2 flex items-center justify-center gap-2 text-sm font-medium backdrop-blur-sm">
          {connectionStatus === "reconnecting" ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              Riconnessione in corso...
            </>
          ) : (
            <>
              <WifiOff className="h-4 w-4" />
              Connessione persa. Riconnessione automatica...
            </>
          )}
        </div>
      )}

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
              {myTeamPoints.points}
            </div>
          </div>
          <div className="h-8 w-px bg-border" />
          <div className="text-center">
            <div className="text-xs text-muted-foreground mb-1">
              Avversari (Team {((myPlayer.team ?? 0) === 0 ? 1 : 0) + 1})
            </div>
            <div className="text-2xl font-bold text-accent" data-testid="opponent-team-points">
              {opponentTeamPoints.points}
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
              <Card
                key={player.id}
                data-testid={`player-seat-top`}
                data-userid={player.userId}
                data-is-turn={currentTurnUserId === player.userId}
                className={`px-4 py-2 bg-card/80 backdrop-blur-sm transition-all ${
                  currentTurnUserId === player.userId
                    ? "ring-2 ring-primary shadow-lg"
                    : ""
                }`}
              >
                <p className="text-sm font-semibold text-foreground">
                  {player.username}
                </p>
                <p className="text-xs text-muted-foreground">
                  {player.isTeammate ? "Socio" : "Avversario"}
                </p>
                {currentTurnUserId === player.userId && countdown !== null && (
                  <p className={`text-xs font-bold mt-0.5 ${countdown <= 10 ? "text-destructive animate-pulse" : "text-muted-foreground"}`}>
                    {countdown}s
                  </p>
                )}
                {currentSignal?.userId === player.userId && (
                  <SignalBadge signal={currentSignal.signal} />
                )}
              </Card>
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
                  <Card
                    key={player.id}
                    className={`px-3 py-2 bg-card/80 backdrop-blur-sm transition-all ${
                      currentTurnUserId === player.userId
                        ? "ring-2 ring-primary shadow-lg"
                        : ""
                    }`}
                  >
                    <p className="text-sm font-semibold">{player.username}</p>
                    <p className="text-xs text-muted-foreground">
                      {player.isTeammate ? "Socio" : "Avversario"}
                    </p>
                    {currentSignal?.userId === player.userId && (
                      <SignalBadge signal={currentSignal.signal} />
                    )}
                  </Card>
                ))}
            </div>

            {/* Right Player */}
            <div className="absolute right-0 top-1/2 -translate-y-1/2">
              {playersWithPositions
                .filter((p) => p.position === "right")
                .map((player) => (
                  <Card
                    key={player.id}
                    className={`px-3 py-2 bg-card/80 backdrop-blur-sm transition-all ${
                      currentTurnUserId === player.userId
                        ? "ring-2 ring-primary shadow-lg"
                        : ""
                    }`}
                  >
                    <p className="text-sm font-semibold">{player.username}</p>
                    <p className="text-xs text-muted-foreground">
                      {player.isTeammate ? "Socio" : "Avversario"}
                    </p>
                    {currentSignal?.userId === player.userId && (
                      <SignalBadge signal={currentSignal.signal} />
                    )}
                  </Card>
                ))}
            </div>

            {/* Central Table with Played Cards */}
            <div className="relative w-80 h-80 rounded-full bg-gradient-to-br from-primary/5 to-accent/5 border-4 border-primary/20 shadow-2xl flex items-center justify-center" data-testid="game-table-center">
              {playedCards.length > 0 ? (
                playedCards.map((playedCard, idx) => {
                  // Mappa userId a posizione visuale
                  const player = playersWithPositions.find(
                    (p) => p.userId === playedCard.userId,
                  );
                  const visualPosition = player?.position ?? "bottom";

                  // Animation class based on player direction
                  const animationClass =
                    visualPosition === "bottom"
                      ? "animate-card-from-bottom"
                      : visualPosition === "top"
                        ? "animate-card-from-top"
                        : visualPosition === "left"
                          ? "animate-card-from-left"
                          : "animate-card-from-right";

                  // Cards are placed near center with small offsets toward their player's side
                  const positionClass =
                    visualPosition === "bottom"
                      ? "top-1/2 left-1/2 -translate-x-1/2 translate-y-2"
                      : visualPosition === "top"
                        ? "top-1/2 left-1/2 -translate-x-1/2 -translate-y-full"
                        : visualPosition === "left"
                          ? "top-1/2 left-1/2 -translate-y-1/2 -translate-x-full"
                          : "top-1/2 left-1/2 -translate-y-1/2 translate-x-2";

                  return (
                    <div
                      key={`${playedCard.userId}-${playedCard.suit}-${playedCard.value}`}
                      className={`absolute ${animationClass} ${positionClass}`}
                    >
                      <PlayingCard
                        suit={playedCard.suit}
                        value={playedCard.value}
                        size="md"
                      />
                    </div>
                  );
                })
              ) : (
                <div className="text-center">
                  <p className="text-muted-foreground text-sm">
                    {currentRound?.briscola === null
                      ? "In attesa che venga scelta la briscola..."
                      : `In attesa di ${playersWithPositions.find((p) => p.userId === currentTurnUserId)?.username ?? "giocatore"}...`}
                  </p>
                  {countdown !== null && (
                    <div
                      className={`mt-2 text-2xl font-bold ${countdown <= 10 ? "text-destructive animate-pulse" : "text-primary"}`}
                    >
                      {countdown}s
                    </div>
                  )}
                </div>
              )}
            </div>
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
              <Card
                key={player.id}
                data-testid="player-seat-bottom"
                data-userid={player.userId}
                data-is-turn={currentTurnUserId === player.userId}
                className={`px-4 py-2 bg-card/80 backdrop-blur-sm transition-all ${
                  currentTurnUserId === player.userId
                    ? "ring-2 ring-primary shadow-lg"
                    : ""
                }`}
              >
                <p className="text-sm font-semibold">{player.username}</p>
              </Card>
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
          username={username}
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
              setRoundEndData(null);
            }
          }}
          roundNumber={roundEndData.roundNumber}
          team0Points={roundEndData.team0Points}
          team1Points={roundEndData.team1Points}
          team0Figures={roundEndData.team0Figures}
          team1Figures={roundEndData.team1Figures}
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
