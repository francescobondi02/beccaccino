import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Users, Plus, Hash, Loader2, Bot } from "lucide-react";
import Header from "@/components/Header";
import AuthDialog from "@/components/AuthDialog";

import {
  registerLobbyHandlers,
  onRoomCreated,
  offRoomCreated,
  onRoomUpdated,
  offRoomUpdated,
  onRoomFull,
  offRoomFull,
  leaveLobby,
  onRoomDeleted,
  offRoomDeleted,
} from "@/sockets/lobbyHandlers";
import { getSocket, isSocketConnected } from "@/sockets/socketClient";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import AuthErrorState from "@/components/AuthErrorState";

// Lista delle 40 carte italiane
const cardFilenames = [
  "asso_bastoni.png",
  "asso_coppe.png",
  "asso_denari.png",
  "asso_spade.png",
  "cavallo_bastoni.png",
  "cavallo_coppe.png",
  "cavallo_denari.png",
  "cavallo_spade.png",
  "cinque_bastoni.png",
  "cinque_coppe.png",
  "cinque_denari.png",
  "cinque_spade.png",
  "due_bastoni.png",
  "due_coppe.png",
  "due_denari.png",
  "due_spade.png",
  "fante_bastoni.png",
  "fante_coppe.png",
  "fante_denari.png",
  "fante_spade.png",
  "quattro_bastoni.png",
  "quattro_coppe.png",
  "quattro_denari.png",
  "quattro_spade.png",
  "re_bastoni.png",
  "re_coppe.png",
  "re_denari.png",
  "re_spade.png",
  "sei_bastoni.png",
  "sei_coppe.png",
  "sei_denari.png",
  "sei_spade.png",
  "sette_bastoni.png",
  "sette_coppe.png",
  "sette_denari.png",
  "sette_spade.png",
  "tre_bastoni.png",
  "tre_coppe.png",
  "tre_denari.png",
  "tre_spade.png",
];

// Funzione per creare array di carte random
const getRandomCards = (count: number) => {
  const cards = [];
  for (let i = 0; i < count; i++) {
    const randomCard =
      cardFilenames[Math.floor(Math.random() * cardFilenames.length)];
    cards.push(randomCard);
  }
  return cards;
};

interface Room {
  id: number;
  code: string;
  currentPlayers: number;
  maxPlayers: number;
  players?: Array<{
    id: number;
    userId: number;
    user?: {
      id: number;
      username: string;
    };
  }>;
}

const Index = () => {
  const navigate = useNavigate();
  const {
    user,
    loading: authLoading,
    error: authError,
    retry: retryAuth,
  } = useAuth();
  const username = user?.username ?? "";
  const userId = user?.id ?? null;
  const isAuthenticated = user !== null;
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [activeGames, setActiveGames] = useState<Room[]>([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  // Carte casuali per le animazioni (generate una sola volta)
  const [leftCards] = useState(() => getRandomCards(20));
  const [rightCards] = useState(() => getRandomCards(20));

  const fetchAvailableRooms = useCallback(async () => {
    setIsLoadingRooms(true);
    try {
      type ApiRoom = Pick<Room, "id" | "code" | "players">;
      const data = await apiGet<{
        availableRooms: ApiRoom[];
        activeGames: ApiRoom[];
      }>("/rooms/available");

      const toRoom = (room: ApiRoom): Room => ({
        id: room.id,
        code: room.code,
        currentPlayers: room.players?.length ?? 0,
        maxPlayers: 4,
        players: room.players,
      });

      // Stanze disponibili (non iniziate) e giochi attivi in cui sono dentro
      const mappedAvailableRooms = data.availableRooms.map(toRoom);
      const mappedActiveGames = data.activeGames.map(toRoom);

      setAvailableRooms(mappedAvailableRooms);
      setActiveGames(mappedActiveGames);
    } catch (error) {
      console.error("Error fetching rooms:", error);
      toast.error("Impossibile caricare le stanze disponibili");
    } finally {
      setIsLoadingRooms(false);
    }
  }, []);

  useEffect(() => {
    if (userId) {
      void fetchAvailableRooms();
      return;
    }
    setAvailableRooms([]);
    setActiveGames([]);
  }, [fetchAvailableRooms, userId]);

  // useEffect per registrare handler + gestionne stato isConnected
  useEffect(() => {
    if (!userId || !isAuthenticated) return;

    // Registra solo una volta
    registerLobbyHandlers(userId);

    // Collega isConnected al socket centrale
    const socket = getSocket();
    const handleConnect = () => setIsConnected(true);
    const handleDisconnect = () => setIsConnected(false);

    setIsConnected(isSocketConnected());
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    // Callback: nuova stanza
    const handleRoomCreated = (room: Room) => {
      setAvailableRooms((prev) => [...prev, room]);
    };

    // Callback: stanza aggiornata
    const handleRoomUpdated = ({
      roomCode,
      currentPlayers,
    }: {
      roomCode: string;
      currentPlayers: number;
    }) => {
      setAvailableRooms((prev) =>
        prev.map((r) => (r.code === roomCode ? { ...r, currentPlayers } : r)),
      );
    };

    // Callback: stanza piena
    const handleRoomFull = ({ roomCode }: { roomCode: string }) => {
      setAvailableRooms((prev) => prev.filter((r) => r.code !== roomCode));
    };

    // Callback: stanza eliminata
    const handleRoomDeleted = ({ roomCode }: { roomCode: string }) => {
      setAvailableRooms((prev) => prev.filter((r) => r.code !== roomCode));
    };

    onRoomCreated(handleRoomCreated);
    onRoomUpdated(handleRoomUpdated);
    onRoomFull(handleRoomFull);
    onRoomDeleted(handleRoomDeleted);

    // Cleanup
    return () => {
      leaveLobby();
      offRoomCreated(handleRoomCreated);
      offRoomUpdated(handleRoomUpdated);
      offRoomFull(handleRoomFull);
      offRoomDeleted(handleRoomDeleted);
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, [userId, isAuthenticated]);

  const handlePractice = () => {
    if (!isAuthenticated) {
      setShowAuthDialog(true);
      return;
    }
    navigate("/practice");
  };

  const handleCreateRoom = async () => {
    if (!isAuthenticated) {
      setShowAuthDialog(true);
      return;
    }

    if (!userId) {
      toast.error("Errore: userId non disponibile");
      return;
    }

    try {
      const room = await apiPost<{ code: string }>("/rooms/", {});
      toast.success("Stanza creata!");
      navigate(`/room/${room.code}`);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.body?.activeRoomCode
      ) {
        toast.error("Sei già in una partita attiva");
        navigate(`/game/${error.body.activeRoomCode}`);
        return;
      }
      console.error("Error creating room:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Impossibile creare la stanza",
      );
    }
  };

  const handleJoinRoom = async (code: string) => {
    if (!isAuthenticated) {
      setShowAuthDialog(true);
      return;
    }

    if (!userId) {
      toast.error("Errore: userId non disponibile");
      return;
    }

    try {
      await apiPost("/rooms/join", { roomCode: code });

      toast.success(`Accesso alla stanza ${code}`);
      navigate(`/room/${code}`);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.body?.activeRoomCode
      ) {
        toast.error("Sei già in una partita attiva");
        navigate(`/game/${error.body.activeRoomCode}`);
        return;
      }
      console.error("Error joining room:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Impossibile entrare nella stanza",
      );
    }
  };

  const handleJoinByCode = async () => {
    if (!isAuthenticated) {
      setShowAuthDialog(true);
      return;
    }
    if (!roomCode.trim()) {
      toast.error("Inserisci un codice stanza");
      return;
    }

    if (!userId) {
      toast.error("Errore: userId non disponibile");
      return;
    }

    try {
      await apiPost("/rooms/join", { roomCode: roomCode.trim() });

      toast.success(`Accesso alla stanza ${roomCode}`);
      navigate(`/room/${roomCode}`);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.body?.activeRoomCode
      ) {
        toast.error("Sei già in una partita attiva");
        navigate(`/game/${error.body.activeRoomCode}`);
        return;
      }
      console.error("Error joining room:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Impossibile entrare nella stanza",
      );
    }
  };

  if (authError) {
    return <AuthErrorState onRetry={retryAuth} />;
  }

  if (authLoading) {
    return (
      <div
        className="min-h-screen bg-background flex items-center justify-center"
        role="status"
        aria-label="Verifica sessione"
      >
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <AuthDialog
        open={showAuthDialog}
        onOpenChange={setShowAuthDialog}
      />

      <div className="min-h-screen flex items-center justify-center p-4 pt-20">
        <div className="w-full max-w-4xl animate-fade-in">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-5xl font-bold bg-gradient-primary bg-clip-text text-transparent mb-3">
              Beccaccino Online - Beta
            </h1>
            <p className="text-muted-foreground text-lg">
              Entra in una stanza o creane una nuova per iniziare a giocare
            </p>
          </div>

          {/* Card Animations - Left Side */}
          <div className="fixed left-0 top-16 bottom-0 w-36 pointer-events-none overflow-hidden opacity-70">
            <div className="infinite-scroll-up">
              {/* Primo set */}
              {leftCards.map((card, i) => (
                <img
                  key={`left-1-${i}`}
                  src={`/images/cards/${card}`}
                  alt=""
                  className="w-24 h-auto rounded-lg shadow-lg mx-auto flex-shrink-0"
                  style={{ transform: `rotate(${(i % 3) * 5 - 5}deg)` }}
                />
              ))}
              {/* Secondo set per loop seamless */}
              {leftCards.map((card, i) => (
                <img
                  key={`left-2-${i}`}
                  src={`/images/cards/${card}`}
                  alt=""
                  className="w-24 h-auto rounded-lg shadow-lg mx-auto flex-shrink-0"
                  style={{ transform: `rotate(${(i % 3) * 5 - 5}deg)` }}
                />
              ))}
            </div>
          </div>

          {/* Card Animations - Right Side */}
          <div className="fixed right-0 top-16 bottom-0 w-36 pointer-events-none overflow-hidden opacity-70">
            <div className="infinite-scroll-down">
              {/* Primo set */}
              {rightCards.map((card, i) => (
                <img
                  key={`right-1-${i}`}
                  src={`/images/cards/${card}`}
                  alt=""
                  className="w-24 h-auto rounded-lg shadow-lg mx-auto flex-shrink-0"
                  style={{ transform: `rotate(${(i % 3) * 5 - 5}deg)` }}
                />
              ))}
              {/* Secondo set per loop seamless */}
              {rightCards.map((card, i) => (
                <img
                  key={`right-2-${i}`}
                  src={`/images/cards/${card}`}
                  alt=""
                  className="w-24 h-auto rounded-lg shadow-lg mx-auto flex-shrink-0"
                  style={{ transform: `rotate(${(i % 3) * 5 - 5}deg)` }}
                />
              ))}
            </div>
          </div>

          {/* Login Prompt for Unauthenticated Users */}
          {!isAuthenticated && (
            <Card className="bg-gradient-card border-border/50 mb-6">
              <CardContent className="pt-6 text-center">
                <p className="text-lg mb-4">
                  Effettua l'accesso per creare o entrare in una stanza
                </p>
                <Button
                  variant="gradient"
                  size="lg"
                  onClick={() => setShowAuthDialog(true)}
                  data-testid="open-auth-button"
                >
                  Accedi / Registrati
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Main Container */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Left Panel - Create/Join */}
            <div className="space-y-6">
              {/* Create Room Card */}
              <Card className="bg-gradient-card border-border/50 hover:border-primary/50 transition-all">
                <CardContent className="pt-6">
                  <Button
                    variant="gradient"
                    size="lg"
                    className="w-full"
                    onClick={handleCreateRoom}
                    data-testid="create-room-button"
                  >
                    <Plus className="mr-2 h-5 w-5" />
                    Crea una nuova stanza
                  </Button>
                </CardContent>
              </Card>

              {/* Practice vs Bots Card */}
              <Card className="bg-gradient-card border-border/50 hover:border-primary/50 transition-all">
                <CardContent className="pt-6">
                  <Button
                    variant="outline"
                    size="lg"
                    className="w-full border-primary/50 hover:bg-primary/10"
                    onClick={handlePractice}
                    data-testid="practice-button"
                  >
                    <Bot className="mr-2 h-5 w-5" />
                    Pratica contro i bot
                  </Button>
                </CardContent>
              </Card>

              {/* Join by Code Card */}
              <Card className="bg-gradient-card border-border/50">
                <CardContent className="pt-6">
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium text-foreground mb-2 block">
                        Codice Stanza
                      </label>
                      <Input
                        placeholder="Inserisci il codice"
                        value={roomCode}
                        onChange={(e) =>
                          setRoomCode(e.target.value.toUpperCase())
                        }
                        className="bg-secondary border-border focus:border-primary uppercase"
                        maxLength={6}
                        data-testid="room-code-input"
                      />
                    </div>

                    <Button
                      variant="outline"
                      size="lg"
                      className="w-full border-primary/50 hover:bg-primary/10"
                      onClick={handleJoinByCode}
                      data-testid="join-by-code-button"
                    >
                      <Hash className="mr-2 h-5 w-5" />
                      Entra con il codice
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right Panel - Rooms Lists */}
            {isAuthenticated && (
              <div className="space-y-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-primary" />
                    <h2 className="text-xl font-semibold">Le tue stanze</h2>
                  </div>
                  {/* Indicatore connessione real-time */}
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        isConnected
                          ? "bg-green-500 animate-pulse"
                          : "bg-gray-400"
                      }`}
                    />
                    <span className="text-xs text-muted-foreground">
                      {isConnected ? "Live" : "Offline"}
                    </span>
                  </div>
                </div>

                {isLoadingRooms ? (
                  <Card className="bg-gradient-card border-border/50">
                    <CardContent className="p-8 text-center">
                      <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-primary" />
                      <p className="text-muted-foreground">
                        Caricamento stanze...
                      </p>
                    </CardContent>
                  </Card>
                ) : availableRooms.length + activeGames.length === 0 ? (
                  <Card className="bg-gradient-card border-border/50">
                    <CardContent className="p-8 text-center">
                      <Users className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-50" />
                      <p className="text-muted-foreground">
                        Nessuna stanza disponibile al momento
                      </p>
                      <p className="text-sm text-muted-foreground mt-2">
                        Sii il primo a creare una stanza!
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-6 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                    {/* Giochi attivi - Partite in corso */}
                    {activeGames.length > 0 && (
                      <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-amber-500 flex items-center gap-2">
                          <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></span>
                          Partite in corso
                        </h3>
                        {activeGames.map((game) => (
                          <Card
                            key={game.id}
                            className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/30 hover:border-amber-500/50 transition-all duration-300 hover:scale-[1.02]"
                          >
                            <CardContent className="p-5">
                              <div className="flex items-center justify-between mb-3">
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <Hash className="h-4 w-4 text-amber-500" />
                                    <span className="font-bold text-lg tracking-wider text-foreground">
                                      {game.code}
                                    </span>
                                    <span className="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-500 rounded-full font-semibold">
                                      IN CORSO
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                    <Users className="h-3.5 w-3.5" />
                                    <span>
                                      {game.currentPlayers} / {game.maxPlayers}{" "}
                                      giocatori
                                    </span>
                                  </div>
                                </div>

                                <Button
                                  variant="default"
                                  size="sm"
                                  onClick={() => navigate(`/game/${game.code}`)}
                                  className="bg-amber-500 hover:bg-amber-600 text-white"
                                >
                                  Rientra
                                </Button>
                              </div>

                              {/* Lista giocatori */}
                              {game.players && game.players.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-amber-500/20">
                                  {game.players.map((player) => (
                                    <span
                                      key={player.id}
                                      className="text-xs px-2 py-1 bg-secondary rounded-md text-muted-foreground"
                                    >
                                      {player.user?.username ?? "Sconosciuto"}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}

                    {/* Stanze disponibili - In attesa di giocatori */}
                    {availableRooms.length > 0 && (
                      <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
                          <Users className="h-4 w-4" />
                          Stanze disponibili
                        </h3>
                        {availableRooms.map((room) => (
                          <Card
                            key={room.id}
                            className="bg-gradient-card border-border/50 hover:border-primary/50 transition-all duration-300 hover:scale-[1.02]"
                          >
                            <CardContent className="p-5">
                              <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <Hash className="h-4 w-4 text-accent" />
                                    <span className="font-bold text-lg tracking-wider text-foreground">
                                      {room.code}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                    <Users className="h-3.5 w-3.5" />
                                    <span>
                                      {room.currentPlayers} / {room.maxPlayers}{" "}
                                      giocatori
                                    </span>
                                  </div>
                                </div>

                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => handleJoinRoom(room.code)}
                                  disabled={
                                    room.currentPlayers >= room.maxPlayers
                                  }
                                  className="hover:bg-primary hover:text-primary-foreground transition-colors"
                                >
                                  {room.currentPlayers >= room.maxPlayers
                                    ? "Piena"
                                    : "Entra"}
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: hsl(var(--secondary));
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: hsl(var(--primary));
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: hsl(var(--accent));
        }

        /* Animazioni infinite per le carte */
        .infinite-scroll-up {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          animation: scroll-up 25s linear infinite;
          will-change: transform;
          transform: translateZ(0);
        }
        
        .infinite-scroll-down {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          animation: scroll-down 25s linear infinite;
          will-change: transform;
          transform: translateZ(0);
        }

        .infinite-scroll-up img,
        .infinite-scroll-down img {
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }

        @keyframes scroll-up {
          from {
            transform: translateY(0);
          }
          to {
            transform: translateY(-50%);
          }
        }

        @keyframes scroll-down {
          from {
            transform: translateY(-50%);
          }
          to {
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
};

export default Index;
