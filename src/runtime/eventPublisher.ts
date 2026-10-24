import { logger } from "../logger";
import { getSocketInstance } from "../socketInstance";

export type GameEvent = {
  target: string;
  event: string;
  payload: unknown;
};

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

export function publishEvents(events: readonly GameEvent[]): void {
  for (const event of events) {
    publishEvent(event.target, event.event, event.payload);
  }
}
