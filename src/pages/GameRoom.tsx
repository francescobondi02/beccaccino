import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Check, X, LogOut, Share2, Loader2, WifiOff, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import Header from "@/components/Header";
import { Badge } from "@/components/ui/badge";

import {
  registerRoomHandlers,
  leaveRoom,
  onPlayerJoined,
  offPlayerJoined,
  onPlayerLeft,
  offPlayerLeft,
  onTeamChosen,
  offTeamChosen,
  onReadyChanged,
  offReadyChanged,
  onGameStarted,
  offGameStarted,
} from "@/sockets/roomHandlers";
import {
  onConnectionStatusChange,
  getConnectionStatus,
} from "@/sockets/socketClient";

interface Player {
  id: number;
  userId: number;
  username: string;
  seat: number | null;
  team: number | null;
  isReady: boolean;
}

interface Room {
  id: number;
  code: string;
  started: boolean;
  finished: boolean;
  players: Player[];
}

const API_URL = import.meta.env.VITE_API_URL;

const GameRoom = () => {
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const [username, setUsername] = useState<string>("");
  const [userId, setUserId] = useState<number | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [myPlayer, setMyPlayer] = useState<Player | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<
    "connected" | "disconnected" | "reconnecting"
  >(getConnectionStatus());

  // Refs for stable references in callbacks
  const userIdRef = useRef<number | null>(null);
  const roomCodeRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);

  // Helper: refetch room data from backend (used on reconnect)
  const refetchRoom = useCallback(async () => {
    const uid = userIdRef.current;
    const code = roomCodeRef.current;
    if (!uid || !code) return;

    try {
      const res = await fetch(`${API_URL}/rooms/${code}?userId=${uid}`, {
        credentials: "include",
      });

      if (!res.ok) return;

      const roomData: Room = await res.json();
      const players: Player[] = roomData.players.map((p: any) => ({
        id: p.id,
        userId: p.userId,
        username: p.user?.username ?? "Sconosciuto",
        seat: p.seat,
        team: p.team,
        isReady: p.isReady,
      }));

      setRoom({ ...roomData, players });

      const me = roomData.players.find((p: any) => p.userId === uid);
      setMyPlayer(me || null);
    } catch (error) {
      console.error("Error refetching room on reconnect:", error);
    }
  }, []);

  // Connection status tracking + refetch on reconnect (skip initial connect)
  useEffect(() => {
    let isInitialConnect = true;

    const unsubscribe = onConnectionStatusChange((status) => {
      setConnectionStatus(status);

      // When socket reconnects (not initial connect), refetch room state
      if (status === "connected") {
        if (isInitialConnect) {
          isInitialConnect = false;
          return; // Skip — initial fetch is handled by the fetchRoom useEffect
        }
        console.log("🔄 Reconnected in lobby — refetching room state");
        refetchRoom();
      } else {
        // Any disconnect/reconnecting resets the flag so next connect triggers refetch
        isInitialConnect = false;
      }
    });

    return unsubscribe;
  }, [refetchRoom]);

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
    if (!userId || !roomCode) return;

    const fetchRoom = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(
          `${API_URL}/rooms/${roomCode}?userId=${userId}`,
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
        const me = roomData.players.find((p) => p.userId === userId);
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
  }, [userId, roomCode, navigate]);

  // Gestione WebSocket room
  useEffect(() => {
    if (!userId || !username || !roomCode) return;

    const user = { userId, username };
    // Ref locale per sapere se la partita è iniziata (navigazione a GameTable)
    let gameStarted = false;

    // Connessione a registrazione handler
    registerRoomHandlers(roomCode, user);

    // Callback per quando un nuovo player si unisce
    const handlePlayerJoined = (joinedPlayer: Player) => {
      console.log("👥 Nuovo giocatore:", joinedPlayer);

      setRoom((prevRoom) => {
        // console.log("Giocatori attuali:", prevRoom.players);
        // console.log("Nuovo giocatore:", joinedPlayer);
        if (!prevRoom) return prevRoom;

        // Evita duplicati
        const alreadyExists = prevRoom.players.some(
          (p) => p.userId === joinedPlayer.userId,
        );
        if (alreadyExists) return prevRoom;

        return {
          ...prevRoom,
          players: [...prevRoom.players, joinedPlayer],
        };
      });
    };

    const handlePlayerLeft = (leftUserId: number) => {
      console.log("👋 Giocatore uscito:", leftUserId);
      setRoom((prevRoom) => {
        if (!prevRoom) return prevRoom;
        return {
          ...prevRoom,
          players: prevRoom.players.filter((p) => p.userId !== leftUserId),
        };
      });
    };

    const handleTeamChosen = (data: { userId: number; team: number }) => {
      console.log("🏳️‍🌈 Team scelto:", data);
      setRoom((prevRoom) => {
        if (!prevRoom) return prevRoom;
        const updatedPlayers = prevRoom.players.map((p) =>
          p.userId === data.userId ? { ...p, team: data.team } : p,
        );
        return { ...prevRoom, players: updatedPlayers };
      });

      if (data.userId === userId && myPlayer) {
        setMyPlayer({ ...myPlayer, team: data.team });
      }
    };

    const handleReadyChanged = (data: { userId: number; isReady: boolean }) => {
      console.log("✅ Stato pronto cambiato:", data);
      setRoom((prevRoom) => {
        if (!prevRoom) return prevRoom;
        const updatedPlayers = prevRoom.players.map((p) =>
          p.userId === data.userId ? { ...p, isReady: data.isReady } : p,
        );
        return { ...prevRoom, players: updatedPlayers };
      });

      if (data.userId === userId && myPlayer) {
        setMyPlayer({ ...myPlayer, isReady: data.isReady });
      }
    };

    // Callback per quando la partita inizia

    // Registra la callback
    onPlayerJoined(handlePlayerJoined);
    onPlayerLeft(handlePlayerLeft);
    onTeamChosen(handleTeamChosen);
    onReadyChanged(handleReadyChanged);
    onGameStarted(() => {
      gameStarted = true; // 🔥 Non disconnettere quando si naviga a GameTable
      toast.success("La partita sta per iniziare! Redirecting...");
      setTimeout(() => {
        navigate(`/game/${roomCode}`);
      }, 5000);
    });

    return () => {
      // Cleanup: rimuovi solo i listener locali
      offPlayerJoined(handlePlayerJoined);
      offPlayerLeft(handlePlayerLeft);
      offTeamChosen(handleTeamChosen);
      offReadyChanged(handleReadyChanged);
      offGameStarted();
      // 🔥 Lascia la room socket SOLO se la partita NON è iniziata
      if (!gameStarted) {
        leaveRoom(roomCode);
      }
    };
  }, [userId, username, roomCode]);

  const handleReady = async () => {
    if (!myPlayer || !userId) return;

    const newReadyState = !myPlayer.isReady;

    try {
      const res = await fetch(`${API_URL}/rooms/${roomCode}/ready`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId, isReady: newReadyState }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Errore nell'impostare lo stato");
      }

      const data = await res.json();

      // Aggiorna lo stato locale
      setMyPlayer({ ...myPlayer, isReady: newReadyState });

      if (room) {
        const updatedPlayers = room.players.map((p) =>
          p.userId === userId ? { ...p, isReady: newReadyState } : p,
        );
        setRoom({ ...room, players: updatedPlayers });
      }

      toast.success(newReadyState ? "Sei pronto!" : "Non più pronto");

      // Se tutti sono pronti (e il numero di giocatori è 4), la partita inizia
      if (data.allReady && room && room.players.length === 4) {
        toast.success("Tutti pronti! La partita sta per iniziare...");
      }
    } catch (error) {
      console.error("Error setting ready:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Errore nell'impostare lo stato",
      );
    }
  };

  const handleLogout = async () => {
    try {
      const res = await fetch(`${API_URL}/users/logout`, {
        method: "POST",
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error("Errore durante il logout");
      }

      setUsername("");
      setIsAuthenticated(false);
      toast.success("Logout effettuato");
      navigate("/");
    } catch (error) {
      console.error("Logout error:", error);
      toast.error("Errore durante il logout");
    }
  };

  const handleShareLink = () => {
    const inviteUrl = `${window.location.origin}/room/${roomCode}`;
    navigator.clipboard.writeText(inviteUrl);
    toast.success("Link di invito copiato!");
  };

  const handleLeaveRoom = async () => {
    try {
      await fetch(`${API_URL}/rooms/${roomCode}/leave`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      toast.success("Hai lasciato la stanza");
      navigate("/");
    } catch (error) {
      console.error("Errore nel lasciare la stanza:", error);
      toast.error("Errore nel lasciare la stanza");
    }
  };

  const handleChooseTeam = async (team: number) => {
    if (!userId) return;

    try {
      const res = await fetch(`${API_URL}/rooms/${roomCode}/choose-team`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId, team }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Errore nella scelta del team");
      }

      // Aggiorna lo stato locale
      if (myPlayer) {
        setMyPlayer({ ...myPlayer, team });
      }

      if (room) {
        const updatedPlayers = room.players.map((p) =>
          p.userId === userId ? { ...p, team } : p,
        );
        setRoom({ ...room, players: updatedPlayers });
      }

      toast.success(`Sei nel Team ${team + 1}!`);
    } catch (error) {
      console.error("Error choosing team:", error);
      toast.error(
        error instanceof Error ? error.message : "Errore nella scelta del team",
      );
    }
  };

  // Crea array di 4 player (riempiendo gli slot vuoti)
  const allPlayers: (Player | null)[] = [];

  const currentPlayers = [...(room?.players ?? [])].sort((a, b) => {
    if (a.userId === userId) return -1;
    if (b.userId === userId) return 1;
    return a.username.localeCompare(b.username);
  });

  // Riempie gli slot con i player presenti
  for (let i = 0; i < 4; i++) {
    allPlayers[i] = currentPlayers[i] || null;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="bg-gradient-card border-border/50">
          <CardContent className="p-8 text-center">
            <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground text-lg">
              Caricamento stanza...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="bg-gradient-card border-border/50">
          <CardContent className="p-8 text-center">
            <p className="text-destructive text-lg">Stanza non trovata</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
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

      <Header username={username} onLogout={handleLogout} />

      <div className="container mx-auto px-4 pt-24 pb-12">
        <div className="max-w-4xl mx-auto animate-fade-in">
          {/* Room Info Card */}
          <Card className="bg-gradient-card border-border/50 mb-8">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Users className="h-6 w-6 text-primary" />
                  <span data-testid="room-code-display">Stanza: {roomCode}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleShareLink}
                  className="gap-2"
                >
                  <Share2 className="h-4 w-4" />
                  Condividi link
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-center">
                {room.started
                  ? "La partita è iniziata!"
                  : "In attesa che tutti i giocatori siano pronti..."}
              </p>
              <p className="text-sm text-muted-foreground text-center mt-2">
                Giocatori: {room.players.length} / 4
              </p>
            </CardContent>
          </Card>

          {/* Players Grid */}
          <div className="grid md:grid-cols-2 gap-4 mb-8">
            {allPlayers.map((player, index) => {
              const isMe = player?.userId === userId;
              return (
                <Card
                  key={index}
                  className={`bg-gradient-card border-border/50 transition-all duration-300 ${
                    player
                      ? "hover:border-primary/50 hover:scale-[1.02]"
                      : "opacity-50"
                  } ${isMe ? "ring-2 ring-primary" : ""}`}
                >
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg ${
                            player
                              ? "bg-gradient-primary text-primary-foreground"
                              : "bg-secondary text-muted-foreground"
                          }`}
                        >
                          {player ? (
                            // Prendi solo le iniziali
                            player?.username
                              .split(" ")
                              .map((n) => n[0])
                              .join("")
                              .toUpperCase()
                          ) : (
                            <X className="h-6 w-6" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-lg">
                              {player ? player.username : "In attesa..."}
                            </p>
                            {isMe && (
                              <Badge variant="secondary" className="text-xs">
                                Tu
                              </Badge>
                            )}
                          </div>
                          {player && (
                            <>
                              <div className="flex items-center gap-1.5 mt-1">
                                <div
                                  className={`w-2 h-2 rounded-full ${
                                    player.isReady
                                      ? "bg-accent animate-pulse"
                                      : "bg-muted-foreground"
                                  }`}
                                />
                                <p
                                  className={`text-sm font-medium ${
                                    player.isReady
                                      ? "text-accent"
                                      : "text-muted-foreground"
                                  }`}
                                >
                                  {player.isReady ? "Pronto" : "Non pronto"}
                                </p>
                              </div>
                              {player.team !== null && (
                                <Badge
                                  variant="outline"
                                  className="text-xs mt-1"
                                >
                                  Team {player.team + 1}
                                </Badge>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      {player && (
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                            player.isReady
                              ? "bg-accent/20 text-accent"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {player.isReady ? (
                            <Check className="h-5 w-5" />
                          ) : (
                            <X className="h-5 w-5" />
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Actions */}
          <div className="grid sm:grid-cols-2 gap-4">
            <Button
              variant={myPlayer?.isReady ? "secondary" : "gradient"}
              size="lg"
              onClick={handleReady}
              className="w-full"
              disabled={!myPlayer || myPlayer.team === null}
              data-testid="ready-button"
            >
              <Check className="mr-2 h-5 w-5" />
              {myPlayer?.isReady ? "Non pronto" : "Sono pronto!"}
            </Button>

            <Button
              variant="outline"
              size="lg"
              className="w-full border-destructive/50 hover:bg-destructive/10 text-destructive"
              onClick={handleLeaveRoom}
              data-testid="leave-room-button"
            >
              <LogOut className="mr-2 h-5 w-5" />
              Lascia la stanza
            </Button>
          </div>

          {myPlayer?.team === null && (
            <Card className="bg-gradient-card border-border/50 mt-6">
              <CardContent className="p-6 text-center">
                <p className="text-muted-foreground mb-4">
                  Scegli una squadra prima di poterti mettere pronto
                </p>
                <div className="flex gap-4 justify-center">
                  <Button
                    variant="outline"
                    onClick={() => handleChooseTeam(0)}
                    disabled={
                      room.players.filter((p) => p.team === 0).length >= 2
                    }
                    data-testid="team-0-button"
                  >
                    Team 1 ({room.players.filter((p) => p.team === 0).length}/2)
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleChooseTeam(1)}
                    disabled={
                      room.players.filter((p) => p.team === 1).length >= 2
                    }
                    data-testid="team-1-button"
                  >
                    Team 2 ({room.players.filter((p) => p.team === 1).length}/2)
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default GameRoom;
