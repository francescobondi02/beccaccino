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

// Room pages and the lobby refetch on these.
export function publishRoomChanged(roomCode: string): void {
  publishEvent(roomCode, "room_changed", { roomCode });
  publishEvent("lobby", "lobby_changed", { roomCode });
}
