import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Check, X, LogOut, Copy } from "lucide-react";
import { toast } from "sonner";
import Header from "@/components/Header";
import { Badge } from "@/components/ui/badge";
import italianCard from "@/assets/italian-card.png";

interface Player {
  id: number;
  name: string | null;
  isReady: boolean;
  isMe: boolean;
}

const GameRoom = () => {
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const [username] = useState("Mario Rossi");
  const [isReady, setIsReady] = useState(false);

  const [players, setPlayers] = useState<Player[]>([
    { id: 1, name: "Mario Rossi", isReady: false, isMe: true },
    { id: 2, name: "Luigi Verdi", isReady: true, isMe: false },
    { id: 3, name: "Anna Bianchi", isReady: false, isMe: false },
    { id: 4, name: null, isReady: false, isMe: false },
  ]);

  const handleReady = () => {
    const newReadyState = !isReady;
    setIsReady(newReadyState);
    
    setPlayers(players.map(p => 
      p.isMe ? { ...p, isReady: newReadyState } : p
    ));
    
    toast.success(newReadyState ? "Sei pronto!" : "Non più pronto");
  };

  const handleLeaveRoom = () => {
    toast.success("Hai lasciato la stanza");
    navigate("/");
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomCode || "");
    toast.success("Codice copiato!");
  };

  const handleLogout = () => {
    toast.success("Logout effettuato");
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background">
      <Header username={username} onLogout={handleLogout} />

      {/* Background Cards */}
      <div className="fixed left-0 top-16 bottom-0 w-32 pointer-events-none overflow-hidden opacity-20">
        <div className="animate-scroll-up space-y-4">
          {[...Array(12)].map((_, i) => (
            <img
              key={i}
              src={italianCard}
              alt=""
              className="w-20 h-auto rounded-lg shadow-lg mx-auto"
              style={{ transform: `rotate(${(i % 3) * 5 - 5}deg)` }}
            />
          ))}
        </div>
      </div>

      <div className="fixed right-0 top-16 bottom-0 w-32 pointer-events-none overflow-hidden opacity-20">
        <div className="animate-scroll-down space-y-4">
          {[...Array(12)].map((_, i) => (
            <img
              key={i}
              src={italianCard}
              alt=""
              className="w-20 h-auto rounded-lg shadow-lg mx-auto"
              style={{ transform: `rotate(${(i % 3) * 5 - 5}deg)` }}
            />
          ))}
        </div>
      </div>

      <div className="container mx-auto px-4 pt-24 pb-12">
        <div className="max-w-4xl mx-auto animate-fade-in">
          {/* Room Info Card */}
          <Card className="bg-gradient-card border-border/50 mb-8">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Users className="h-6 w-6 text-primary" />
                  <span>Stanza: {roomCode}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyCode}
                  className="gap-2"
                >
                  <Copy className="h-4 w-4" />
                  Copia codice
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-center">
                In attesa che tutti i giocatori siano pronti...
              </p>
            </CardContent>
          </Card>

          {/* Players Grid */}
          <div className="grid md:grid-cols-2 gap-4 mb-8">
            {players.map((player) => (
              <Card
                key={player.id}
                className={`bg-gradient-card border-border/50 transition-all duration-300 ${
                  player.name ? "hover:border-primary/50 hover:scale-[1.02]" : "opacity-50"
                } ${player.isMe ? "ring-2 ring-primary" : ""}`}
              >
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg ${
                          player.name
                            ? "bg-gradient-primary text-primary-foreground"
                            : "bg-secondary text-muted-foreground"
                        }`}
                      >
                        {player.name ? (
                          player.name.split(" ").map(n => n[0]).join("").toUpperCase()
                        ) : (
                          <X className="h-6 w-6" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-lg">
                            {player.name || "In attesa..."}
                          </p>
                          {player.isMe && (
                            <Badge variant="secondary" className="text-xs">Tu</Badge>
                          )}
                        </div>
                        {player.name && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <div
                              className={`w-2 h-2 rounded-full ${
                                player.isReady ? "bg-accent animate-pulse" : "bg-muted-foreground"
                              }`}
                            />
                            <p
                              className={`text-sm font-medium ${
                                player.isReady ? "text-accent" : "text-muted-foreground"
                              }`}
                            >
                              {player.isReady ? "Pronto" : "Non pronto"}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    {player.name && (
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
            ))}
          </div>

          {/* Actions */}
          <div className="grid sm:grid-cols-2 gap-4">
            <Button
              variant={isReady ? "secondary" : "gradient"}
              size="lg"
              onClick={handleReady}
              className="w-full"
            >
              <Check className="mr-2 h-5 w-5" />
              {isReady ? "Non pronto" : "Sono pronto!"}
            </Button>

            <Button
              variant="outline"
              size="lg"
              className="w-full border-destructive/50 hover:bg-destructive/10 text-destructive"
              onClick={handleLeaveRoom}
            >
              <LogOut className="mr-2 h-5 w-5" />
              Lascia la stanza
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GameRoom;
