import { TurnPhase } from "../game/transitions/types";

type TimerState = {
  timeout: NodeJS.Timeout;
  roomCode: string;
  currentTurnUserId: number;
  phase: TurnPhase;
  startedAt: number;
  durationMs: number;
  isBot: boolean;
  pauseEpoch: number;
};

const activeTimers = new Map<string, TimerState>();

export function scheduleTurnTimer(args: {
  roomCode: string;
  userId: number;
  phase: TurnPhase;
  pauseEpoch: number;
  durationMs: number;
  isBot: boolean;
  onElapsed: () => void | Promise<void>;
}): void {
  clearTurnTimer(args.roomCode);
  const startedAt = Date.now();
  const timeout = setTimeout(() => {
    const current = activeTimers.get(args.roomCode);
    if (current?.timeout !== timeout) return;
    activeTimers.delete(args.roomCode);
    void args.onElapsed();
  }, args.durationMs);
  timeout.unref();
  activeTimers.set(args.roomCode, {
    timeout,
    roomCode: args.roomCode,
    currentTurnUserId: args.userId,
    phase: args.phase,
    startedAt,
    durationMs: args.durationMs,
    isBot: args.isBot,
    pauseEpoch: args.pauseEpoch,
  });
}

export function clearTurnTimer(roomCode: string): void {
  const timer = activeTimers.get(roomCode);
  if (!timer) return;
  clearTimeout(timer.timeout);
  activeTimers.delete(roomCode);
}

export function getTurnTimerState(roomCode: string): {
  remainingMs: number;
  totalMs: number;
  turnUserId: number;
  phase: TurnPhase;
  isBot: boolean;
} | null {
  const timer = activeTimers.get(roomCode);
  if (!timer) return null;
  return {
    remainingMs: Math.max(0, timer.durationMs - (Date.now() - timer.startedAt)),
    totalMs: timer.durationMs,
    turnUserId: timer.currentTurnUserId,
    phase: timer.phase,
    isBot: timer.isBot,
  };
}

export function hasScheduledTurn(
  roomCode: string,
  userId: number,
  phase: TurnPhase,
  pauseEpoch: number,
): boolean {
  const timer = activeTimers.get(roomCode);
  return Boolean(
    timer &&
      timer.currentTurnUserId === userId &&
      timer.phase === phase &&
      timer.pauseEpoch === pauseEpoch,
  );
}

export function activeTimerRoomCodes(): string[] {
  return [...activeTimers.keys()];
}

export function clearAllTurnTimers(): void {
  for (const roomCode of activeTimers.keys()) clearTurnTimer(roomCode);
}

const STALE_TIMER_THRESHOLD_MS = 2 * 60 * 60 * 1000;
const cleanupStaleTimers = setInterval(() => {
  const now = Date.now();
  for (const [roomCode, timer] of activeTimers.entries()) {
    if (now - timer.startedAt > STALE_TIMER_THRESHOLD_MS) {
      clearTurnTimer(roomCode);
    }
  }
}, 10 * 60 * 1000);
cleanupStaleTimers.unref();
