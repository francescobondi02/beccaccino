import type { LiveGame, LivePlayer } from "../../game/liveGame";
import type { TurnPhase } from "../../contract/game";

const TABLE_SEATS = 4;

function seatAfter(seat: number, offset = 1): number {
  return (seat + offset) % TABLE_SEATS;
}

export function nextCallerPlayerId(
  players: { id: number; seat: number | null }[],
  previousCallerId: number,
): number | null {
  const previous = players.find((player) => player.id === previousCallerId);
  if (!previous || previous.seat === null) return null;
  const nextSeat = seatAfter(previous.seat);
  return players.find((player) => player.seat === nextSeat)?.id ?? null;
}

// Who acts next and how; null when the game is not live.
export function currentTurn(
  game: Pick<LiveGame, "room" | "players" | "round" | "trick">,
): { player: LivePlayer; phase: TurnPhase } | null {
  const { round, trick, players } = game;
  if (!game.room.started || game.room.finished || game.room.pausedAt || !round) return null;
  const seatOf = (playerId: number) =>
    players.find((player) => player.id === playerId)!.seat!;
  const seat =
    round.briscola === null || !trick
      ? seatOf(round.callerId)
      : seatAfter(seatOf(trick.starterId), trick.cards.length);
  const player = players.find((candidate) => candidate.seat === seat);
  if (!player) return null;
  return { player, phase: round.briscola === null ? "choose_briscola" : "play_card" };
}
