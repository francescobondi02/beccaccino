import type { PlayerPosition, TotalPoints } from "@/game/model";
import type { RoomPlayer } from "@/rooms/model";

export interface PositionedPlayer extends RoomPlayer {
  position: PlayerPosition;
  isLocalPlayer: boolean;
  isTeammate: boolean;
}

const POSITIONS: PlayerPosition[] = ["bottom", "left", "top", "right"];

export function positionPlayers(
  players: RoomPlayer[],
  currentUserId: number | null,
): PositionedPlayer[] {
  const currentPlayer = players.find(
    (player) => player.userId === currentUserId,
  );
  if (!currentPlayer) return [];

  const seatedPlayers = [...players].sort((left, right) => {
    if (left.seat === null) return 1;
    if (right.seat === null) return -1;
    return left.seat - right.seat;
  });
  const currentPlayerIndex = seatedPlayers.findIndex(
    (player) => player.userId === currentUserId,
  );
  if (currentPlayerIndex === -1) return [];

  return seatedPlayers.map((player, index) => ({
    ...player,
    position:
      POSITIONS[(index - currentPlayerIndex + POSITIONS.length) % POSITIONS.length],
    isLocalPlayer: player.userId === currentUserId,
    isTeammate:
      player.userId !== currentUserId && player.team === currentPlayer.team,
  }));
}

export function pointsForPlayerTeam(
  totalPoints: TotalPoints,
  team: number | null,
) {
  if (team === 0) {
    return {
      own: totalPoints.team0Points,
      opponents: totalPoints.team1Points,
    };
  }
  return {
    own: totalPoints.team1Points,
    opponents: totalPoints.team0Points,
  };
}
