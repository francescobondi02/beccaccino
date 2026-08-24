import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Check, X, LogOut, Share2, Loader2, WifiOff, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import Header from "@/components/Header";
import AuthErrorState from "@/components/AuthErrorState";
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
  registerErrorToast,
} from "@/sockets/socketClient";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { normalizePlayer, type RawRoomPlayer } from "@/lib/player";

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

type RoomResponse = Omit<Room, "players"> & { players: RawRoomPlayer[] };

function normalizeRoom(room: RoomResponse): Room {
  return {
    ...room,
    players: room.players.map(normalizePlayer),
  };
}

// Long enough to read the "starting" toast before landing on the table.
const GAME_START_REDIRECT_MS = 5000;

const GameRoom = () => {
  const { roomCode } = useParams();
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
      const roomData = await apiGet<RoomResponse>(`/rooms/${code}`);
      setRoom(normalizeRoom(roomData));
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
        refetchRoom();
      } else {
        // Any disconnect/reconnecting resets the flag so next connect triggers refetch
        isInitialConnect = false;
      }
    });

    return unsubscribe;
  }, [refetchRoom]);

  // Carica i dati della stanza
  useEffect(() => {
    if (!userId || !roomCode) return;

    const fetchRoom = async () => {
      setIsLoading(true);
      try {
        const roomData = await apiGet<RoomResponse>(
          `/rooms/${roomCode}?userId=${userId}`,
        );
        setRoom(normalizeRoom(roomData));
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
  }, [userId, roomCode, navigate]);

  // Gestione WebSocket room
  useEffect(() => {
    if (!userId || !username || !roomCode) return;

    const user = { userId, username };
    // Ref locale per sapere se la partita è iniziata (navigazione a GameTable)
    let gameStarted = false;

    // Connessione a registrazione handler
    registerRoomHandlers(roomCode, user);
    const unsubscribeErrorToast = registerErrorToast();

    // Callback per quando un nuovo player si unisce
    const handlePlayerJoined = (joinedPlayer: Player) => {

      setRoom((prevRoom) => {
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
      setRoom((prevRoom) => {
        if (!prevRoom) return prevRoom;
        return {
          ...prevRoom,
          players: prevRoom.players.filter((p) => p.userId !== leftUserId),
        };
      });
    };

    const handleTeamChosen = (data: { userId: number; team: number }) => {
      setRoom((prevRoom) => {
        if (!prevRoom) return prevRoom;
        const updatedPlayers = prevRoom.players.map((p) =>
          p.userId === data.userId ? { ...p, team: data.team } : p,
        );
        return { ...prevRoom, players: updatedPlayers };
      });

    };

    const handleReadyChanged = (data: { userId: number; isReady: boolean }) => {
      setRoom((prevRoom) => {
        if (!prevRoom) return prevRoom;
        const updatedPlayers = prevRoom.players.map((p) =>
          p.userId === data.userId ? { ...p, isReady: data.isReady } : p,
        );
        return { ...prevRoom, players: updatedPlayers };
      });

    };

    // Callback per quando la partita inizia

    let gameStartTimeout: ReturnType<typeof setTimeout> | undefined;
    const handleGameStarted = () => {
      gameStarted = true; // 🔥 Non disconnettere quando si naviga a GameTable
      toast.success("La partita sta per iniziare! Redirecting...");
      gameStartTimeout = setTimeout(() => {
        navigate(`/game/${roomCode}`);
      }, GAME_START_REDIRECT_MS);
    };

    // Registra la callback
    onPlayerJoined(handlePlayerJoined);
    onPlayerLeft(handlePlayerLeft);
    onTeamChosen(handleTeamChosen);
    onReadyChanged(handleReadyChanged);
    onGameStarted(handleGameStarted);

    return () => {
      // Cleanup: rimuovi solo i listener locali
      offPlayerJoined(handlePlayerJoined);
      offPlayerLeft(handlePlayerLeft);
      offTeamChosen(handleTeamChosen);
      offReadyChanged(handleReadyChanged);
      offGameStarted(handleGameStarted);
      clearTimeout(gameStartTimeout);
      unsubscribeErrorToast();
      // 🔥 Lascia la room socket SOLO se la partita NON è iniziata
      if (!gameStarted) {
        leaveRoom(roomCode);
      }
    };
  }, [navigate, roomCode, userId, username]);

  const handleReady = async () => {
    if (!myPlayer || !userId) return;

    const newReadyState = !myPlayer.isReady;

    try {
      const data = await apiPost<{ allReady?: boolean }>(
        `/rooms/${roomCode}/ready`,
        { isReady: newReadyState },
      );

      setRoom((currentRoom) =>
        currentRoom
          ? {
              ...currentRoom,
              players: currentRoom.players.map((player) =>
                player.userId === userId
                  ? { ...player, isReady: newReadyState }
                  : player,
              ),
            }
          : currentRoom,
      );

      toast.success(newReadyState ? "Sei pronto!" : "Non più pronto");

      // Se tutti sono pronti (e il numero di giocatori è 4), la partita inizia
      if (data.allReady && room?.players.length === 4) {
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

  const handleShareLink = () => {
    const inviteUrl = `${window.location.origin}/room/${roomCode}`;
    navigator.clipboard.writeText(inviteUrl);
    toast.success("Link di invito copiato!");
  };

  const handleLeaveRoom = async () => {
    try {
      await apiPost(`/rooms/${roomCode}/leave`, {});

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
      await apiPost(`/rooms/${roomCode}/choose-team`, { team });

      setRoom((currentRoom) =>
        currentRoom
          ? {
              ...currentRoom,
              players: currentRoom.players.map((player) =>
                player.userId === userId ? { ...player, team } : player,
              ),
            }
          : currentRoom,
      );

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

  if (authError) {
    return <AuthErrorState onRetry={retryAuth} />;
  }

  if (authLoading || isLoading) {
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

      <Header />

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
