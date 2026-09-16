import { Bot, Hash, Loader2, Pause, Play, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { LobbyRoom } from "@/rooms/lobbyState";

interface LobbyRoomListsProps {
  availableRooms: LobbyRoom[];
  ordinaryActiveGames: LobbyRoom[];
  pausedPracticeGames: LobbyRoom[];
  isConnected: boolean;
  isLoading: boolean;
  resumingRoomCode: string | null;
  onJoin: (roomCode: string) => void;
  onOpenGame: (roomCode: string) => void;
  onResumePractice: (roomCode: string) => void;
}

export default function LobbyRoomLists({
  availableRooms,
  ordinaryActiveGames,
  pausedPracticeGames,
  isConnected,
  isLoading,
  resumingRoomCode,
  onJoin,
  onOpenGame,
  onResumePractice,
}: LobbyRoomListsProps) {
  const hasRooms =
    availableRooms.length + ordinaryActiveGames.length + pausedPracticeGames.length >
    0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">Le tue stanze</h2>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isConnected ? "bg-green-500 animate-pulse" : "bg-gray-400"
            }`}
          />
          <span className="text-xs text-muted-foreground">
            {isConnected ? "Live" : "Offline"}
          </span>
        </div>
      </div>

      {isLoading ? (
        <Card className="bg-gradient-card border-border/50">
          <CardContent className="p-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-primary" />
            <p className="text-muted-foreground">Caricamento stanze...</p>
          </CardContent>
        </Card>
      ) : !hasRooms ? (
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
          {pausedPracticeGames.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
                <Pause className="h-4 w-4" />
                Allenamenti in pausa
              </h3>
              {pausedPracticeGames.map((game) => (
                <Card
                  key={game.id}
                  className="bg-gradient-card border-primary/30 hover:border-primary/50 transition-all duration-300 hover:scale-[1.02]"
                >
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Hash className="h-4 w-4 text-primary" />
                          <span className="font-bold text-lg tracking-wider text-foreground">
                            {game.code}
                          </span>
                          <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full font-semibold">
                            IN PAUSA
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Bot className="h-3.5 w-3.5" />
                          <span>Partita contro i bot</span>
                        </div>
                      </div>

                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => onResumePractice(game.code)}
                        disabled={resumingRoomCode !== null}
                      >
                        {resumingRoomCode === game.code ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Play className="mr-2 h-4 w-4" />
                        )}
                        Riprendi
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {ordinaryActiveGames.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-amber-500 flex items-center gap-2">
                <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                Partite in corso
              </h3>
              {ordinaryActiveGames.map((game) => (
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
                            {game.currentPlayers} / {game.maxPlayers} giocatori
                          </span>
                        </div>
                      </div>

                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => onOpenGame(game.code)}
                        className="bg-amber-500 hover:bg-amber-600 text-white"
                      >
                        Rientra
                      </Button>
                    </div>

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
                            {room.currentPlayers} / {room.maxPlayers} giocatori
                          </span>
                        </div>
                      </div>

                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onJoin(room.code)}
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
  );
}
