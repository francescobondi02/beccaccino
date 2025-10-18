import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Users, Plus, Hash, Loader2 } from "lucide-react";
import Header from "@/components/Header";
import AuthDialog from "@/components/AuthDialog";
import { useLobbySocket } from "@/hooks/useLobbySocket";

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
  id: string;
  code: string;
  currentPlayers: number;
  maxPlayers: number;
}

const API_URL = import.meta.env.VITE_API_URL;

const Index = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState<string>("");
  const [userId, setUserId] = useState<number | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);

  // Carte casuali per le animazioni (generate una sola volta)
  const [leftCards] = useState(() => getRandomCards(20));
  const [rightCards] = useState(() => getRandomCards(20));

  // 🔥 WebSocket per aggiornamenti real-time della lobby
  const { isConnected, onRoomCreated, onRoomUpdated, onRoomFull } =
    useLobbySocket({
      userId,
      isAuthenticated,
    });

  const handleAuthSuccess = async (newUsername: string, newUserId: number) => {
    setUsername(newUsername);
    setUserId(newUserId);
    setIsAuthenticated(true);
    setShowAuthDialog(false);

    // Carica le stanze disponibili
    await fetchAvailableRooms(newUserId);
  };

  const fetchAvailableRooms = async (userIdParam: number) => {
    setIsLoadingRooms(true);
    try {
      const res = await fetch(
        `${API_URL}/rooms/available?userId=${userIdParam}`,
        {
          credentials: "include",
        }
      );

      if (!res.ok) {
        throw new Error("Errore nel recupero delle stanze");
      }

      const data = await res.json();
      setRooms(data);
    } catch (error) {
      console.error("Error fetching rooms:", error);
      toast.error("Impossibile caricare le stanze disponibili");
    } finally {
      setIsLoadingRooms(false);
    }
  };

  const handleLogout = async () => {
    try {
      const res = await fetch(`${API_URL}/users/logout`, {
        method: "POST",
        credentials: "include", // IMPORTANTE per HTTP-only cookies
      });

      if (!res.ok) {
        throw new Error("Errore durante il logout");
      }

      setUsername("");
      setIsAuthenticated(false);
      toast.success("Logout effettuato");
    } catch (error) {
      console.error("Logout error:", error);
      toast.error("Errore durante il logout");
    }
  };

  // Controlla se l'utente è già autenticato al caricamento
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch(`${API_URL}/users/me`, {
          credentials: "include", // IMPORTANTE per HTTP-only cookies
        });

        if (res.ok) {
          const user = await res.json();
          setUsername(user.username);
          setUserId(user.id);
          setIsAuthenticated(true);

          // Carica le stanze disponibili
          await fetchAvailableRooms(user.id);
        } else {
          setIsAuthenticated(false);
          setUsername("");
          setUserId(null);
        }
      } catch (error) {
        console.error("Auth check error:", error);
        // Utente non autenticato, ignora l'errore
      }
    };

    checkAuth();
  }, []);

  // 🔥 Gestione eventi socket real-time
  useEffect(() => {
    if (!isAuthenticated) return;

    // Evento: Nuova stanza creata
    onRoomCreated((newRoom) => {
      console.log("🆕 Nuova stanza ricevuta via socket:", newRoom);

      setRooms((prevRooms) => {
        // Evita duplicati
        const exists = prevRooms.some((r) => r.code === newRoom.code);
        if (exists) return prevRooms;

        // Aggiungi la nuova stanza all'inizio della lista
        return [newRoom, ...prevRooms];
      });

      toast.success(`Nuova stanza disponibile: ${newRoom.code}`);
    });

    // Evento: Stanza aggiornata (nuovo giocatore entrato)
    onRoomUpdated((data) => {
      console.log("🔄 Stanza aggiornata via socket:", data);

      setRooms((prevRooms) =>
        prevRooms.map((room) =>
          room.code === data.roomCode
            ? { ...room, currentPlayers: data.currentPlayers }
            : room
        )
      );
    });

    // Evento: Stanza diventata piena (rimuovi dalla lista)
    onRoomFull((data) => {
      console.log("🔒 Stanza piena via socket:", data.roomCode);

      setRooms((prevRooms) =>
        prevRooms.filter((room) => room.code !== data.roomCode)
      );

      toast.info(`La stanza ${data.roomCode} è ora completa`);
    });
  }, [isAuthenticated, onRoomCreated, onRoomUpdated, onRoomFull]);

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
      const res = await fetch(`${API_URL}/rooms/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId }),
      });

      if (!res.ok) {
        throw new Error("Errore nella creazione della stanza");
      }

      const room = await res.json();
      toast.success("Stanza creata!");
      navigate(`/room/${room.code}`);
    } catch (error) {
      console.error("Error creating room:", error);
      toast.error("Impossibile creare la stanza");
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
      const res = await fetch(`${API_URL}/rooms/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ roomCode: code, userId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Errore nell'entrare nella stanza");
      }

      toast.success(`Accesso alla stanza ${code}`);
      navigate(`/room/${code}`);
    } catch (error) {
      console.error("Error joining room:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Impossibile entrare nella stanza"
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
      const res = await fetch(`${API_URL}/rooms/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ roomCode: roomCode.trim(), userId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Errore nell'entrare nella stanza");
      }

      toast.success(`Accesso alla stanza ${roomCode}`);
      navigate(`/room/${roomCode}`);
    } catch (error) {
      console.error("Error joining room:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Impossibile entrare nella stanza"
      );
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header
        username={isAuthenticated ? username : undefined}
        onLogout={handleLogout}
      />

      <AuthDialog
        open={showAuthDialog}
        onOpenChange={setShowAuthDialog}
        onAuthSuccess={handleAuthSuccess}
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
                  >
                    <Plus className="mr-2 h-5 w-5" />
                    Crea una nuova stanza
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
                      />
                    </div>

                    <Button
                      variant="outline"
                      size="lg"
                      className="w-full border-primary/50 hover:bg-primary/10"
                      onClick={handleJoinByCode}
                    >
                      <Hash className="mr-2 h-5 w-5" />
                      Entra con il codice
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Right Panel - Available Rooms */}
            {isAuthenticated && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-primary" />
                    <h2 className="text-xl font-semibold">
                      Stanze Disponibili
                    </h2>
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
                ) : rooms.length === 0 ? (
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
                  <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                    {rooms.map((room) => (
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
                              disabled={room.currentPlayers >= room.maxPlayers}
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
        }
        
        .infinite-scroll-down {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          animation: scroll-down 25s linear infinite;
          will-change: transform;
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
