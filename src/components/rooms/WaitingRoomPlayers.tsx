import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { RoomPlayer } from "@/rooms/model";

interface WaitingRoomPlayersProps {
  players: (RoomPlayer | null)[];
  currentUserId: number | null;
}

function initials(username: string): string {
  return username
    .split(" ")
    .map((name) => name[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function WaitingRoomPlayers({
  players,
  currentUserId,
}: WaitingRoomPlayersProps) {
  return (
    <div className="grid grid-cols-1 gap-4 mb-8 md:grid-cols-2">
      {players.map((player, index) => {
        const isCurrentUser = player?.userId === currentUserId;
        return (
          <Card
            key={player?.id ?? `empty-${index}`}
            className={`circolo-surface transition-[transform,border-color,box-shadow] duration-200 ${
              player
                ? "hover:border-accent/70 hover:-translate-y-0.5"
                : "opacity-50"
            } ${isCurrentUser ? "ring-2 ring-primary" : ""}`}
          >
            <CardContent className="p-6">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className={`w-12 h-12 shrink-0 rounded-full flex items-center justify-center font-bold text-lg ${
                      player
                        ? "bg-gradient-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {player ? (
                      initials(player.username)
                    ) : (
                      <X className="h-6 w-6" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold text-lg" title={player?.username}>
                        {player ? player.username : "In attesa..."}
                      </p>
                      {isCurrentUser && (
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
                          <Badge variant="outline" className="text-xs mt-1">
                            Squadra {player.team + 1}
                          </Badge>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {player && (
                  <div
                    className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center transition-colors ${
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
  );
}
