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
    <div className="arcade-lobby-actions space-y-4">
      <Card className="arcade-create-card border-[#cdb77f]/50 bg-[#fffdf7] shadow-none transition-[transform,border-color,box-shadow] hover:-translate-y-1 hover:border-[#9f6b16]">
        <CardContent className="pt-5">
          <Button
            variant="gradient"
            size="lg"
            className="arcade-create-button w-full rounded-xl bg-[#123d36] shadow-[0_10px_24px_rgba(18,61,54,.2)] hover:bg-[#1b564a]"
            onClick={onCreateRoom}
            data-testid="create-room-button"
          >
            <Plus className="mr-2 h-5 w-5" />
            Crea una nuova stanza
          </Button>
        </CardContent>
      </Card>

      <Card className="arcade-practice-card border-[#cdb77f]/50 bg-[#fffdf7] shadow-none transition-[transform,border-color,box-shadow] hover:-translate-y-1 hover:border-[#9f6b16]">
        <CardContent className="pt-5">
          <Button
            variant="outline"
            size="lg"
            className="arcade-practice-button w-full rounded-xl border-[#1b564a]/45 text-[#123d36] hover:bg-[#123d36]/5"
            onClick={onPractice}
            data-testid="practice-button"
          >
            <Bot className="mr-2 h-5 w-5" />
            Allenati contro i bot
          </Button>
        </CardContent>
      </Card>

      <Card className="arcade-join-card border-[#cdb77f]/50 bg-[#fffdf7] shadow-none">
        <CardContent className="pt-5">
          <div className="space-y-4">
            <div>
              <label htmlFor="room-code" className="mb-2 block text-sm font-medium text-[#123d36]">
                Codice stanza
              </label>
              <Input
                id="room-code"
                placeholder="Es. ABC123"
                value={roomCode}
                onChange={(event) =>
                  onRoomCodeChange(event.target.value.toUpperCase())
                }
                className="border-[#cdb77f]/65 bg-[#f9f0dc] uppercase focus:border-[#1b564a]"
                maxLength={6}
                data-testid="room-code-input"
              />
            </div>

            <Button
              variant="outline"
              size="lg"
              className="arcade-join-button w-full rounded-xl border-[#1b564a]/45 text-[#123d36] hover:bg-[#123d36]/5"
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
