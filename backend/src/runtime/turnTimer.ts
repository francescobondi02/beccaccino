import { logger } from "../logger";

// One timer per room, armed for one game version.
const timers = new Map<string, { timeout: NodeJS.Timeout; version: number; firesAt: number }>();

export function scheduleTurnTimer(
  roomCode: string,
  version: number,
  delayMs: number,
  run: () => Promise<unknown>,
): void {
  clearTurnTimer(roomCode);
  const timeout = setTimeout(async () => {
    if (timers.get(roomCode)?.timeout !== timeout) return;
    timers.delete(roomCode);
    try {
      await run();
    } catch (error) {
      // The reconciler re-arms the room.
      logger.warn({ err: error, roomCode, version }, "turn_execution_failed");
    }
  }, Math.max(0, delayMs));
  timeout.unref();
  timers.set(roomCode, { timeout, version, firesAt: Date.now() + Math.max(0, delayMs) });
}

export function clearTurnTimer(roomCode: string): void {
  const timer = timers.get(roomCode);
  if (timer) clearTimeout(timer.timeout);
  timers.delete(roomCode);
}

export function hasTurnRuntime(roomCode: string, version: number): boolean {
  return timers.get(roomCode)?.version === version;
}

export function getTurnTimerState(roomCode: string): { version: number; remainingMs: number } | null {
  const timer = timers.get(roomCode);
  return timer ? { version: timer.version, remainingMs: Math.max(0, timer.firesAt - Date.now()) } : null;
}

export function clearAllTurnTimers(): void {
  for (const roomCode of [...timers.keys()]) clearTurnTimer(roomCode);
}
