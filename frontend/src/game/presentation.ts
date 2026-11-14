import type { Card } from "@contract/cards";
import type { GamePlayer, Score } from "@contract/game";
import type { PlayerPosition } from "@/game/model";

export interface PositionedPlayer extends GamePlayer {
  position: PlayerPosition;
  isLocalPlayer: boolean;
  isTeammate: boolean;
}

const POSITIONS: PlayerPosition[] = ["bottom", "left", "top", "right"];

export function positionPlayers(
  players: GamePlayer[],
  currentUserId: number | null,
): PositionedPlayer[] {
  const currentPlayer = players.find(
    (player) => player.userId === currentUserId,
  );
  if (!currentPlayer) return [];

  const seatedPlayers = [...players].sort((left, right) => left.seat - right.seat);
  const currentPlayerIndex = seatedPlayers.indexOf(currentPlayer);

  return seatedPlayers.map((player, index) => ({
    ...player,
    position:
      POSITIONS[(index - currentPlayerIndex + POSITIONS.length) % POSITIONS.length],
    isLocalPlayer: player.userId === currentUserId,
    isTeammate:
      player.userId !== currentUserId && player.team === currentPlayer.team,
  }));
}

export function pointsForPlayerTeam(score: Score, team: number | null) {
  return team === 0
    ? { own: score.team0.points, opponents: score.team1.points }
    : { own: score.team1.points, opponents: score.team0.points };
}

export function cardKey(card: Card) {
  return `${card.suit}-${card.value}`;
}
