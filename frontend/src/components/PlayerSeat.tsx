import { Card } from "@/components/ui/card";
import SignalBadge from "@/components/SignalBadge";

interface SeatPlayer {
  userId: number;
  username: string;
  isTeammate?: boolean;
  botModel?: string | null;
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
      className={`circolo-seat ${padding} border-[hsl(39_45%_50%_/_0.52)] py-2.5 bg-card/95 backdrop-blur-sm transition-[box-shadow,transform] ${
        isTurn ? "circolo-seat-active ring-2 ring-primary" : ""
      }`}
    >
      <p className="text-sm font-semibold leading-tight" title={player.username}>{player.username}</p>
      {(showRole || player.botModel) && (
        <p className="text-xs text-muted-foreground">
          {showRole && `${player.isTeammate ? "Socio" : "Avversario"}${player.botModel ? " · " : ""}`}
          {player.botModel && "Bot in gioco"}
        </p>
      )}
      {isTurn && countdown != null && (
        <p
          className={`text-xs font-bold mt-0.5 ${
            countdown <= 10
              ? "text-destructive animate-pulse"
              : "text-accent"
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
