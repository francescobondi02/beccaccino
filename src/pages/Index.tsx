import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Users, Plus, Hash } from "lucide-react";

interface Room {
  id: string;
  code: string;
  currentPlayers: number;
  maxPlayers: number;
}

const Index = () => {
  const [playerName, setPlayerName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [rooms, setRooms] = useState<Room[]>([
    { id: "1", code: "GAME01", currentPlayers: 2, maxPlayers: 4 },
    { id: "2", code: "PLAY42", currentPlayers: 1, maxPlayers: 4 },
    { id: "3", code: "CARD88", currentPlayers: 3, maxPlayers: 4 },
  ]);

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

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-4xl animate-fade-in">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold bg-gradient-primary bg-clip-text text-transparent mb-3">
            Card Game Lobby
          </h1>
          <p className="text-muted-foreground text-lg">Join or create a room to start playing</p>
        </div>

        {/* Main Container */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Left Panel - Create/Join */}
          <div className="space-y-6">
            {/* Player Name Card */}
            <Card className="bg-gradient-card border-border/50">
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-foreground mb-2 block">
                      Your Name
                    </label>
                    <Input
                      placeholder="Enter your name"
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                      className="bg-secondary border-border focus:border-primary"
                    />
                  </div>

                  <Button
                    variant="gradient"
                    size="lg"
                    className="w-full"
                    onClick={handleCreateRoom}
                  >
                    <Plus className="mr-2 h-5 w-5" />
                    Create New Room
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Join by Code Card */}
            <Card className="bg-gradient-card border-border/50">
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-foreground mb-2 block">
                      Room Code
                    </label>
                    <Input
                      placeholder="Enter room code"
                      value={roomCode}
                      onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
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
                    Join by Code
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Panel - Available Rooms */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Users className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Available Rooms</h2>
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
                            {room.currentPlayers} / {room.maxPlayers} players
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
                        {room.currentPlayers >= room.maxPlayers ? "Full" : "Join"}
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
