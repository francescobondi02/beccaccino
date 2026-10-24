import { TurnPhase } from "../game/turn";

const timeoutCounts = new Map<string, Map<number, number>>();
const kickedPlayers = new Map<string, Set<number>>();
const KICK_TIMEOUT_LIMIT = 3;

export function turnDurationMs(phase: TurnPhase): number {
  const seconds =
    phase === "choose_briscola"
      ? process.env.BRISCOLA_TIMEOUT_SECONDS || "90"
      : process.env.TURN_TIMEOUT_SECONDS || "60";
  return parseInt(seconds, 10) * 1000;
}

export function botThinkDelayMs(): number {
  return parseInt(process.env.BOT_THINK_DELAY_MS || "1000", 10);
}

export function isPlayerKicked(roomCode: string, userId: number): boolean {
  return kickedPlayers.get(roomCode)?.has(userId) ?? false;
}

export function recordTimeout(
  roomCode: string,
  userId: number,
): { count: number; newlyKicked: boolean } {
  if (!timeoutCounts.has(roomCode)) {
    timeoutCounts.set(roomCode, new Map());
  }
  const roomCounts = timeoutCounts.get(roomCode)!;
  const count = (roomCounts.get(userId) ?? 0) + 1;
  roomCounts.set(userId, count);

  const alreadyKicked = isPlayerKicked(roomCode, userId);
  const newlyKicked = count >= KICK_TIMEOUT_LIMIT && !alreadyKicked;
  if (newlyKicked) {
    if (!kickedPlayers.has(roomCode)) {
      kickedPlayers.set(roomCode, new Set());
    }
    kickedPlayers.get(roomCode)!.add(userId);
  }
  return { count, newlyKicked };
}

export function resetTimeoutCount(roomCode: string, userId: number): void {
  timeoutCounts.get(roomCode)?.delete(userId);
}

export function getTimeoutState(
  roomCode: string,
  userId: number,
): { timeouts: number; kicked: boolean } {
  return {
    timeouts: timeoutCounts.get(roomCode)?.get(userId) ?? 0,
    kicked: isPlayerKicked(roomCode, userId),
  };
}

export function clearTimeoutPolicy(roomCode: string): void {
  timeoutCounts.delete(roomCode);
  kickedPlayers.delete(roomCode);
}

export function clearAllTimeoutPolicy(): void {
  timeoutCounts.clear();
  kickedPlayers.clear();
}
