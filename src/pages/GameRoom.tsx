import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, ArrowLeft, Check, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface Player {
  id: string;
  name: string;
  isReady: boolean;
  isHost: boolean;
}

const GameRoom = () => {
  const navigate = useNavigate();
  const [players, setPlayers] = useState<Player[]>([
    { id: "1", name: "Mario", isReady: true, isHost: true },
    { id: "2", name: "Luigi", isReady: false, isHost: false },
    { id: "3", name: "Peach", isReady: true, isHost: false },
  ]);

  const currentPlayerId = "1"; // Mock current user
  const roomCode = "GAME01"; // Mock room code

  const toggleReady = () => {
    setPlayers(
      players.map((p) =>
        p.id === currentPlayerId ? { ...p, isReady: !p.isReady } : p
      )
    );
  };

  const handleLeaveRoom = () => {
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-4xl animate-fade-in">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-4 mb-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLeaveRoom}
              className="absolute left-4 top-4"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-4xl font-bold bg-gradient-primary bg-clip-text text-transparent">
              Stanza: {roomCode}
            </h1>
          </div>
          <p className="text-muted-foreground">
            In attesa che tutti i giocatori siano pronti...
          </p>
        </div>

        {/* Players Grid */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {players.map((player) => (
            <Card
              key={player.id}
              className="bg-gradient-card border-border/50 hover:border-primary/50 transition-all duration-300"
            >
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-gradient-primary flex items-center justify-center text-primary-foreground font-bold text-lg">
                      {player.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-lg text-foreground">
                          {player.name}
                        </span>
                        {player.isHost && (
                          <Badge variant="secondary" className="text-xs">
                            Host
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {player.isReady ? (
                          <>
                            <Check className="h-4 w-4 text-green-500" />
                            <span className="text-sm text-green-500 font-medium">
                              Pronto
                            </span>
                          </>
                        ) : (
                          <>
                            <X className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">
                              Non pronto
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {/* Empty Slots */}
          {[...Array(4 - players.length)].map((_, i) => (
            <Card
              key={`empty-${i}`}
              className="bg-gradient-card border-border/50 border-dashed opacity-50"
            >
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
                    <Users className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <span className="text-muted-foreground">
                    In attesa di giocatore...
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Ready Button */}
        <div className="flex justify-center">
          <Button
            variant={
              players.find((p) => p.id === currentPlayerId)?.isReady
                ? "outline"
                : "gradient"
            }
            size="lg"
            className="min-w-[200px]"
            onClick={toggleReady}
          >
            {players.find((p) => p.id === currentPlayerId)?.isReady ? (
              <>
                <X className="mr-2 h-5 w-5" />
                Non sono pronto
              </>
            ) : (
              <>
                <Check className="mr-2 h-5 w-5" />
                Sono pronto
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default GameRoom;
