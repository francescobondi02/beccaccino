import { logger } from "../logger";
import { getSocketInstance } from "../socketInstance";
import { GameEvent } from "../game/transitions/types";

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

export async function runBestEffort(
  operation: () => Promise<void>,
  name: string,
  context: Record<string, unknown> = {},
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    logger.warn({ err: error, ...context }, `${name}_failed`);
  }
}
