import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Users, Plus, Hash } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Room {
  id: string;
  code: string;
  currentPlayers: number;
  maxPlayers: number;
}

const API_URL = import.meta.env.VITE_API_URL;

const Index = () => {
  const [playerName, setPlayerName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [rooms, setRooms] = useState<Room[]>([
    { id: "1", code: "GAME01", currentPlayers: 2, maxPlayers: 4 },
    { id: "2", code: "PLAY42", currentPlayers: 1, maxPlayers: 4 },
    { id: "3", code: "CARD88", currentPlayers: 3, maxPlayers: 4 },
  ]);
  const [showNameDialog, setShowNameDialog] = useState(true);

  const fetchRooms = async () => {
    try {
      // console.log(`${API_URL}/rooms/available`);
      const res = await fetch(`${API_URL}/rooms/available`);
      if (!res.ok) throw new Error("Errore nel recupero stanze");
      const data = await res.json();
      console.log("Stanze disponibili:", data);
      setRooms(data);
    } catch (err) {
      console.error("Errore nel fetch delle stanze:", err);
      toast.error("Impossibile caricare le stanze disponibili");
    }
  };

  const handleCreateRoom = () => {
    if (!playerName.trim()) {
      toast.error("Please enter your name");
      return;
    }
    toast.success(`Room created! (Player: ${playerName})`);
  };

  const handleJoinRoom = (code: string) => {
    if (!playerName.trim()) {
      toast.error("Please enter your name");
      return;
    }
    toast.success(`Joined room ${code}! (Player: ${playerName})`);
  };

  const handleJoinByCode = () => {
    if (!playerName.trim()) {
      toast.error("Please enter your name");
      return;
    }
    if (!roomCode.trim()) {
      toast.error("Please enter a room code");
      return;
    }
    toast.success(`Joining room ${roomCode}! (Player: ${playerName})`);
  };

  const handleConfirmName = async () => {
    const trimmed = playerName.trim();
    if (!trimmed) {
      toast.error("Inserisci un nome valido");
      return;
    }

    try {
      const res = await fetch(`${API_URL}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmed }),
      });

      if (!res.ok) throw new Error("Errore creazione utente");

      const user = await res.json();
      console.log("Utente creato:", user);
      setShowNameDialog(false);
    } catch (err) {
      console.error("Errore creazione utente:", err);
      toast.error("Errore nella creazione dell'utente");
    }
  };

  useEffect(() => {
    if (!showNameDialog) {
      fetchRooms();
    }
  }, [showNameDialog]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Dialog open={showNameDialog}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle className="text-center">Come ti chiami?</DialogTitle>
          </DialogHeader>

          <Input
            placeholder="Inserisci il tuo nome"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
          />

          <Button
            variant="gradient"
            className="w-full mt-4"
            onClick={handleConfirmName}
          >
            Continua
          </Button>
        </DialogContent>
      </Dialog>
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
        <div className="fixed left-0 top-0 bottom-0 w-32 pointer-events-none overflow-hidden opacity-20">
          <div className="animate-scroll-up space-y-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="w-20 h-28 bg-gradient-primary rounded-lg shadow-lg mx-auto" />
            ))}
          </div>
        </div>

        {/* Card Animations - Right Side */}
        <div className="fixed right-0 top-0 bottom-0 w-32 pointer-events-none overflow-hidden opacity-20">
          <div className="animate-scroll-down space-y-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="w-20 h-28 bg-gradient-primary rounded-lg shadow-lg mx-auto" />
            ))}
          </div>
        </div>

        {/* Main Container */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Left Panel - Create/Join */}
          <div className="space-y-6">
            {/* Create Room Card */}
            <Card className="bg-gradient-card border-border/50">
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
                      placeholder="Inserisci il codice della stanza"
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
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Users className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Stanze Disponibili</h2>
            </div>

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
                            {room.currentPlayers} / {room.maxPlayers} giocatori
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
      `}</style>
    </div>
  );
};

export default Index;
