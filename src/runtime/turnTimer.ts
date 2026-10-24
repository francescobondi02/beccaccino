import {
  isSameTurn,
  TurnIdentity,
  TurnPhase,
} from "../game/turn";

type TimerState = {
  timeout: NodeJS.Timeout;
  currentTurnUserId: number;
  phase: TurnPhase;
  startedAt: number;
  durationMs: number;
  isBot: boolean;
  pauseEpoch: number;
  identity: TurnIdentity;
};

const activeTimers = new Map<string, TimerState>();

export function scheduleTurnTimer(args: {
  roomCode: string;
  userId: number;
  phase: TurnPhase;
  pauseEpoch: number;
  identity: TurnIdentity;
  durationMs: number;
  isBot: boolean;
  onElapsed: () => void | Promise<void>;
  onFailed?: (error: unknown) => void | Promise<void>;
}): void {
  clearTurnTimer(args.roomCode);
  const startedAt = Date.now();
  const timeout = setTimeout(() => {
    void executeTurn(args.roomCode, timeout, args.onElapsed, args.onFailed);
  }, args.durationMs);
  timeout.unref();
  activeTimers.set(args.roomCode, {
    timeout,
    currentTurnUserId: args.userId,
    phase: args.phase,
    startedAt,
    durationMs: args.durationMs,
    isBot: args.isBot,
    pauseEpoch: args.pauseEpoch,
    identity: args.identity,
  });
}

async function executeTurn(
  roomCode: string,
  timeout: NodeJS.Timeout,
  onElapsed: () => void | Promise<void>,
  onFailed?: (error: unknown) => void | Promise<void>,
): Promise<void> {
  const current = activeTimers.get(roomCode);
  if (current?.timeout !== timeout) return;

  let failed = false;
  let failure: unknown;
  try {
    await onElapsed();
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    if (activeTimers.get(roomCode)?.timeout === timeout) {
      activeTimers.delete(roomCode);
    }
  }

  if (failed && onFailed) {
    try {
      await onFailed(failure);
    } catch {
      // The periodic runtime reconciler remains the retry backstop.
    }
  }
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

export function hasTurnRuntime(
  roomCode: string,
  userId: number,
  phase: TurnPhase,
  pauseEpoch: number,
  identity: TurnIdentity,
): boolean {
  const timer = activeTimers.get(roomCode);
  return Boolean(
    timer &&
      timer.currentTurnUserId === userId &&
      timer.phase === phase &&
      timer.pauseEpoch === pauseEpoch &&
      isSameTurn(timer.identity, identity),
  );
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
