import { useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import PlayingCard from "@/components/PlayingCard";
import TrumpSuitDialog from "@/components/TrumpSuitDialog";
import LastTrickDialog from "@/components/LastTrickDialog";
import { ArrowLeft } from "lucide-react";

type PlayerPosition = "bottom" | "top" | "left" | "right";

type Player = {
  username: string;
  position: PlayerPosition;
  isLocalPlayer?: boolean;
  isTeammate?: boolean;
};

type PlayedCard = {
  playerId: string;
  position: PlayerPosition;
  cardId: string;
};

const GameTable = () => {
  const { gameRoomCode } = useParams();
  const [trumpDialogOpen, setTrumpDialogOpen] = useState(false);
  const [lastTrickDialogOpen, setLastTrickDialogOpen] = useState(false);

  // Mock data for players
  const players: Player[] = [
    { username: "Tu", position: "bottom", isLocalPlayer: true },
    { username: "Giovanni", position: "top", isTeammate: true },
    { username: "Paolo", position: "left" },
    { username: "Matteo", position: "right" },
  ];

  // Mock local player's hand (10 cards)
  const playerHand = Array.from({ length: 10 }, (_, i) => ({
    id: `card-${i}`,
    suit: "coins",
    value: i + 1,
  }));

  // Mock played cards on table
  const playedCards: PlayedCard[] = [
    { playerId: "player1", position: "bottom", cardId: "card-played-1" },
    { playerId: "player2", position: "top", cardId: "card-played-2" },
    { playerId: "player3", position: "left", cardId: "card-played-3" },
  ];

  // Mock team points
  const teamPoints = { team1: 10, team2: 18 };

  const handleCardClick = (cardId: string) => {
    console.log("Carta premuta:", cardId);
    // Play card logic will go here
  };

  const handleTrumpSelect = (suit: string) => {
    console.log("Seme di briscola selezionato:", suit);
    setTrumpDialogOpen(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/30 to-accent/20 relative overflow-hidden">
      {/* Background decorative elements */}
      <div className="absolute inset-0 bg-gradient-warm opacity-20 pointer-events-none" />

      {/* Header with room code and back button */}
      {false && (
        <div className="absolute top-4 left-4 z-10">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.history.back()}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Lascia la partita
          </Button>
        </div>
      )}

      <div className="absolute top-4 right-4 text-sm text-muted-foreground">
        Room:{" "}
        <span className="font-semibold text-foreground">{gameRoomCode}</span>
      </div>

      {/* Team Points Panel */}
      <Card className="absolute top-4 left-1/2 -translate-x-1/2 px-6 py-3 shadow-lg border-2">
        <div className="flex items-center gap-6">
          <div className="text-center">
            <div className="text-xs text-muted-foreground mb-1">
              La tua squadra
            </div>
            <div className="text-2xl font-bold text-primary">
              {teamPoints.team1}
            </div>
          </div>
          <div className="h-8 w-px bg-border" />
          <div className="text-center">
            <div className="text-xs text-muted-foreground mb-1">Avversari</div>
            <div className="text-2xl font-bold text-accent">
              {teamPoints.team2}
            </div>
          </div>
        </div>
      </Card>

      {/* Main game area */}
      <div className="container mx-auto h-screen flex flex-col justify-between items-center py-20 px-4">
        {/* Top Player (Teammate) */}
        <div className="flex flex-col items-center gap-2">
          <Card className="px-4 py-2 bg-card/80 backdrop-blur-sm">
            <p className="text-sm font-semibold text-foreground">
              {players.find((p) => p.position === "top")?.username}
            </p>
            <p className="text-xs text-muted-foreground">Socio</p>
          </Card>
        </div>

        {/* Central Table Area */}
        <div className="flex-1 flex items-center justify-center w-full max-w-4xl">
          <div className="relative w-full h-full max-h-96 flex items-center justify-center">
            {/* Left Player (Opponent) */}
            <div className="absolute left-0 top-1/2 -translate-y-1/2">
              <Card className="px-3 py-2 bg-card/80 backdrop-blur-sm">
                <p className="text-sm font-semibold">
                  {players.find((p) => p.position === "left")?.username}
                </p>
                <p className="text-xs text-muted-foreground">Avversario</p>
              </Card>
            </div>

            {/* Right Player (Opponent) */}
            <div className="absolute right-0 top-1/2 -translate-y-1/2">
              <Card className="px-3 py-2 bg-card/80 backdrop-blur-sm">
                <p className="text-sm font-semibold">
                  {players.find((p) => p.position === "right")?.username}
                </p>
                <p className="text-xs text-muted-foreground">Avversario</p>
              </Card>
            </div>

            {/* Central Table with Played Cards */}
            <div className="relative w-80 h-80 rounded-full bg-gradient-to-br from-primary/5 to-accent/5 border-4 border-primary/20 shadow-2xl flex items-center justify-center">
              {/* Played cards positioned in cross layout */}
              {playedCards.map((playedCard) => (
                <div
                  key={playedCard.cardId}
                  className={`absolute ${
                    playedCard.position === "bottom"
                      ? "bottom-8"
                      : playedCard.position === "top"
                      ? "top-8"
                      : playedCard.position === "left"
                      ? "left-8"
                      : "right-8"
                  } ${
                    playedCard.position === "left" ||
                    playedCard.position === "right"
                      ? "top-1/2 -translate-y-1/2"
                      : ""
                  } ${
                    playedCard.position === "top" ||
                    playedCard.position === "bottom"
                      ? "left-1/2 -translate-x-1/2"
                      : ""
                  }`}
                >
                  <PlayingCard suit="coins" value={5} size="md" />
                </div>
              ))}

              {playedCards.length === 0 && (
                <p className="text-muted-foreground text-sm">
                  Waiting for cards...
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Bottom: Local Player Info + Hand */}
        <div className="flex flex-col items-center gap-4 w-full">
          {/* Player's Hand */}
          <div className="flex gap-2 flex-wrap justify-center max-w-5xl">
            {playerHand.map((card) => (
              <PlayingCard
                key={card.id}
                suit={card.suit}
                value={card.value}
                onClick={() => handleCardClick(card.id)}
                size="lg"
                clickable
              />
            ))}
          </div>

          {/* Local Player Info */}
          <Card className="px-4 py-2 bg-card/80 backdrop-blur-sm">
            <p className="text-sm font-semibold">
              {players.find((p) => p.position === "bottom")?.username}
            </p>
          </Card>
        </div>
      </div>

      {/* Game Action Buttons */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setLastTrickDialogOpen(true)}
        >
          Ultima Mano
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={() => setTrumpDialogOpen(true)}
        >
          Scegli Briscola
        </Button>
      </div>

      {/* Dialogs */}
      <TrumpSuitDialog
        open={trumpDialogOpen}
        onOpenChange={setTrumpDialogOpen}
        onSelectSuit={handleTrumpSelect}
      />
      <LastTrickDialog
        open={lastTrickDialogOpen}
        onOpenChange={setLastTrickDialogOpen}
      />
    </div>
  );
};

export default GameTable;
