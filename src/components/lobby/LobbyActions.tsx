import { Bot, Hash, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface LobbyActionsProps {
  roomCode: string;
  onRoomCodeChange: (roomCode: string) => void;
  onCreateRoom: () => void;
  onPractice: () => void;
  onJoinByCode: () => void;
}

export default function LobbyActions({
  roomCode,
  onRoomCodeChange,
  onCreateRoom,
  onPractice,
  onJoinByCode,
}: LobbyActionsProps) {
  return (
    <div className="space-y-6">
      <Card className="bg-gradient-card border-border/50 hover:border-primary/50 transition-all">
        <CardContent className="pt-6">
          <Button
            variant="gradient"
            size="lg"
            className="w-full"
            onClick={onCreateRoom}
            data-testid="create-room-button"
          >
            <Plus className="mr-2 h-5 w-5" />
            Crea una nuova stanza
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-gradient-card border-border/50 hover:border-primary/50 transition-all">
        <CardContent className="pt-6">
          <Button
            variant="outline"
            size="lg"
            className="w-full border-primary/50 hover:bg-primary/10"
            onClick={onPractice}
            data-testid="practice-button"
          >
            <Bot className="mr-2 h-5 w-5" />
            Pratica contro i bot
          </Button>
        </CardContent>
      </Card>

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
                onChange={(event) =>
                  onRoomCodeChange(event.target.value.toUpperCase())
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
              onClick={onJoinByCode}
              data-testid="join-by-code-button"
            >
              <Hash className="mr-2 h-5 w-5" />
              Entra con il codice
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
