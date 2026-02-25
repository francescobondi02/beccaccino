import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import PlayingCard from "@/components/PlayingCard";
import TrumpSuitDialog from "@/components/TrumpSuitDialog";
import LastTrickDialog from "@/components/LastTrickDialog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  registerRoomHandlers,
  leaveRoom,
  onPlayerLeft,
  offPlayerLeft,
} from "@/sockets/roomHandlers";

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

const API_URL = import.meta.env.VITE_API_URL;

const GameTable = () => {
  const { gameRoomCode } = useParams();
  const navigate = useNavigate();
  const [username, setUsername] = useState<string>("");
  const [userId, setUserId] = useState<number | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
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

  // Controlla autenticazione
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch(`${API_URL}/users/me`, {
          credentials: "include",
        });

        if (res.ok) {
          const user = await res.json();
          setUsername(user.username);
          setUserId(user.id);
          setIsAuthenticated(true);
        } else {
          toast.error("Devi effettuare l'accesso");
          navigate("/");
        }
      } catch (error) {
        console.error("Auth check error:", error);
        toast.error("Errore di autenticazione");
        navigate("/");
      }
    };

    checkAuth();
  }, [navigate]);

  // Carica i dati della stanza
  useEffect(() => {
    if (!userId || !gameRoomCode) return;

    const fetchRoom = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(
          `${API_URL}/rooms/${gameRoomCode}?userId=${userId}`,
          {
            credentials: "include",
          },
        );

        if (!res.ok) {
          if (res.status === 404) {
            toast.error("Stanza non trovata");
          } else if (res.status === 403) {
            toast.error("Non sei un giocatore in questa stanza");
          } else {
            toast.error("Errore nel caricamento della stanza");
          }
          navigate("/");
          return;
        }

        const roomData: Room = await res.json();

        // Verifica che la partita sia iniziata
        if (!roomData.started) {
          toast.error("La partita non è ancora iniziata");
          navigate(`/room/${gameRoomCode}`);
          return;
        }

        // Normalizza i giocatori per compatibilità con l'interfaccia
        const players: Player[] = roomData.players.map((p: any) => ({
          id: p.id,
          userId: p.userId,
          username: p.user?.username ?? "Sconosciuto",
          seat: p.seat,
          team: p.team,
          isReady: p.isReady,
        }));

        setRoom({ ...roomData, players });

        // Trova il player corrente
        const me = players.find((p) => p.userId === userId);
        setMyPlayer(me || null);
      } catch (error) {
        console.error("Error fetching room:", error);
        toast.error("Impossibile caricare i dati della stanza");
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
        const res = await fetch(
          `${API_URL}/games/${gameRoomCode}/state?userId=${userId}`,
          { credentials: "include" },
        );
        if (!res.ok) return;
        const data = await res.json();
        setCurrentRound(data.round);
        setCallerUserId(data.callerUserId);
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

  // Gestione WebSocket: mantieni la connessione alla room durante la partita
  useEffect(() => {
    if (!userId || !username || !gameRoomCode) return;

    // Ri-registra gli handler senza emettere join_room se già connessi,
    // oppure ri-joina la room se per qualche motivo la connessione si è persa
    registerRoomHandlers(gameRoomCode, { userId, username });

    const handlePlayerLeft = (leftUserId: number) => {
      console.log("👋 Giocatore uscito durante la partita:", leftUserId);
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

    return () => {
      offPlayerLeft(handlePlayerLeft);
      // NON chiamare leaveRoom qui: lo farà solo il bottone "Lascia la partita"
    };
  }, [userId, username, gameRoomCode]);

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

  // Mock data per le carte in mano (TODO: ottenere dal backend)
  const playerHand = Array.from({ length: 10 }, (_, i) => ({
    id: `card-${i}`,
    suit: "coins",
    value: i + 1,
  }));

  // Mock data per le carte giocate (TODO: ottenere dal backend)
  const playedCards: any[] = [];

  // Mock team points (TODO: ottenere dal backend)
  const teamPoints = { myTeam: 0, opponentTeam: 0 };

  const handleCardClick = (cardId: string) => {
    console.log("Carta giocata:", cardId);
    // TODO: Implementare logica per giocare la carta
    toast.info("Funzionalità in sviluppo");
  };

  const handleTrumpSelect = async (suit: string) => {
    if (!myPlayer || !room) return;
    try {
      const res = await fetch(`${API_URL}/games/choose-briscola`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          gameRoomId: room.id,
          playerId: myPlayer.id,
          suit,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Errore nella scelta della briscola");
        return;
      }
      setCurrentRound((prev) => (prev ? { ...prev, briscola: suit } : prev));
      setTrumpDialogOpen(false);
      toast.success(`Briscola scelta: ${suit}`);
    } catch (error) {
      console.error("Error choosing briscola:", error);
      toast.error("Errore nella scelta della briscola");
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
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/30 to-accent/20 relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute inset-0 bg-gradient-warm opacity-20 pointer-events-none" />

      <div className="absolute top-4 right-4 text-sm text-muted-foreground">
        Room:{" "}
        <span className="font-semibold text-foreground">{gameRoomCode}</span>
      </div>

      {/* Team Points Panel */}
      <Card className="absolute top-4 left-1/2 -translate-x-1/2 px-6 py-3 shadow-lg border-2 bg-card/80 backdrop-blur-sm">
        <div className="flex items-center gap-6">
          <div className="text-center">
            <div className="text-xs text-muted-foreground mb-1">
              La tua squadra (Team {(myPlayer.team ?? 0) + 1})
            </div>
            <div className="text-2xl font-bold text-primary">
              {teamPoints.myTeam}
            </div>
          </div>
          <div className="h-8 w-px bg-border" />
          <div className="text-center">
            <div className="text-xs text-muted-foreground mb-1">
              Avversari (Team {((myPlayer.team ?? 0) === 0 ? 1 : 0) + 1})
            </div>
            <div className="text-2xl font-bold text-accent">
              {teamPoints.opponentTeam}
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
                className="px-4 py-2 bg-card/80 backdrop-blur-sm"
              >
                <p className="text-sm font-semibold text-foreground">
                  {player.username}
                </p>
                <p className="text-xs text-muted-foreground">
                  {player.isTeammate ? "Socio" : "Avversario"}
                </p>
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
                    className="px-3 py-2 bg-card/80 backdrop-blur-sm"
                  >
                    <p className="text-sm font-semibold">{player.username}</p>
                    <p className="text-xs text-muted-foreground">
                      {player.isTeammate ? "Socio" : "Avversario"}
                    </p>
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
                    className="px-3 py-2 bg-card/80 backdrop-blur-sm"
                  >
                    <p className="text-sm font-semibold">{player.username}</p>
                    <p className="text-xs text-muted-foreground">
                      {player.isTeammate ? "Socio" : "Avversario"}
                    </p>
                  </Card>
                ))}
            </div>

            {/* Central Table with Played Cards */}
            <div className="relative w-80 h-80 rounded-full bg-gradient-to-br from-primary/5 to-accent/5 border-4 border-primary/20 shadow-2xl flex items-center justify-center">
              {playedCards.length > 0 ? (
                playedCards.map((playedCard) => (
                  <div
                    key={`${playedCard.playerId}-${playedCard.cardId}`}
                    className={`absolute ${
                      playedCard.position === "bottom"
                        ? "bottom-8 left-1/2 -translate-x-1/2"
                        : playedCard.position === "top"
                          ? "top-8 left-1/2 -translate-x-1/2"
                          : playedCard.position === "left"
                            ? "left-8 top-1/2 -translate-y-1/2"
                            : "right-8 top-1/2 -translate-y-1/2"
                    }`}
                  >
                    <PlayingCard
                      suit={playedCard.suit}
                      value={playedCard.value}
                      size="md"
                    />
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground text-sm">
                  In attesa delle carte...
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Bottom: Local Player Info + Hand */}
        <div className="flex flex-col items-center gap-4 w-full">
          {/* Player's Hand */}
          <div className="flex gap-2 flex-wrap justify-center max-w-5xl">
            {playerHand.map((card) => (
              <PlayingCard
                key={card.id}
                suit={card.suit}
                value={card.value}
                onClick={() => handleCardClick(card.id)}
                size="lg"
                clickable
              />
            ))}
          </div>

          {/* Local Player Info */}
          {playersWithPositions
            .filter((p) => p.position === "bottom")
            .map((player) => (
              <Card
                key={player.id}
                className="px-4 py-2 bg-card/80 backdrop-blur-sm"
              >
                <p className="text-sm font-semibold">{player.username}</p>
              </Card>
            ))}
        </div>
      </div>

      {/* Game Action Buttons */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2">
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
          >
            Scegli Briscola
          </Button>
        )}
      </div>

      {/* Dialogs */}
      <TrumpSuitDialog
        open={trumpDialogOpen}
        onSelectSuit={handleTrumpSelect}
      />
      <LastTrickDialog
        open={lastTrickDialogOpen}
        onOpenChange={setLastTrickDialogOpen}
      />
    </div>
  );
};

export default GameTable;
