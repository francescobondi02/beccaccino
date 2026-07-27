import { Card } from "@/components/ui/card";
import SignalBadge from "@/components/SignalBadge";

interface SeatPlayer {
  userId: number;
  username: string;
  isTeammate?: boolean;
}

interface PlayerSeatProps {
  player: SeatPlayer;
  isTurn: boolean;
  showRole?: boolean;
  countdown?: number | null;
  signal?: string | null;
  // Present only on the vertical-axis seats (self + partner), which Playwright
  // targets by testid and which use wider horizontal padding than the side seats.
  testId?: string;
}

const PlayerSeat = ({
  player,
  isTurn,
  showRole = false,
  countdown,
  signal,
  testId,
}: PlayerSeatProps) => {
  const padding = testId ? "px-4" : "px-3";
  const testAttrs = testId
    ? {
        "data-testid": testId,
        "data-userid": player.userId,
        "data-is-turn": isTurn,
      }
    : {};

  return (
    <Card
      {...testAttrs}
      className={`${padding} py-2 bg-card/80 backdrop-blur-sm transition-all ${
        isTurn ? "ring-2 ring-primary shadow-lg" : ""
      }`}
    >
      <p className="text-sm font-semibold">{player.username}</p>
      {showRole && (
        <p className="text-xs text-muted-foreground">
          {player.isTeammate ? "Socio" : "Avversario"}
        </p>
      )}
      {isTurn && countdown != null && (
        <p
          className={`text-xs font-bold mt-0.5 ${
            countdown <= 10
              ? "text-destructive animate-pulse"
              : "text-muted-foreground"
          }`}
        >
          {countdown}s
        </p>
      )}
      {signal && <SignalBadge signal={signal} />}
    </Card>
  );
};

export default PlayerSeat;
