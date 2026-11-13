import { logger } from "../logger";
import { getSocketInstance } from "../socketInstance";

export function publishEvent(
  target: string,
  event: string,
  payload: unknown,
  context: Record<string, unknown> = {},
): void {
  try {
    getSocketInstance().to(target).emit(event, payload);
  } catch (error) {
    logger.warn(
      { err: error, event, target, ...context },
      "event_publication_failed",
    );
  }
}

// Room pages and the lobby refetch on these. Skip the lobby for changes it does not list.
export function publishRoomChanged(roomCode: string, { lobby = true } = {}): void {
  publishEvent(roomCode, "room_changed", { roomCode });
  if (lobby) publishEvent("lobby", "lobby_changed", { roomCode });
}
