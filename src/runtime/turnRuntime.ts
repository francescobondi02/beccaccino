import {
  TurnIdentity,
  TurnPhase,
} from "../game/turn";
import { logger } from "../logger";
import { publishEvent } from "./eventPublisher";
import {
  botTierForTurn,
  clearAllBotSeats,
  clearBotSeats,
} from "./botRegistry";
import {
  botThinkDelayMs,
  clearAllTimeoutPolicy,
  clearTimeoutPolicy,
  isPlayerKicked,
  turnDurationMs,
} from "./timeoutPolicy";
import {
  clearAllTurnTimers,
  clearTurnTimer,
  scheduleTurnTimer,
} from "./turnTimer";

export function startRuntimeTurn(
  roomCode: string,
  userId: number,
  phase: TurnPhase,
  pauseEpoch: number,
  identity: TurnIdentity,
): void {
  const botTier = botTierForTurn(roomCode, userId);
  const isBot = botTier !== null;
  const durationMs = isBot
    ? botThinkDelayMs()
    : isPlayerKicked(roomCode, userId)
      ? 500
      : turnDurationMs(phase);

  scheduleTurnTimer({
    roomCode,
    userId,
    phase,
    pauseEpoch,
    identity,
    durationMs,
    isBot,
    onElapsed: async () => {
      if (botTier) {
        const { executeBotTurn } = await import("./botExecutor");
        await executeBotTurn({
          roomCode,
          userId,
          tier: botTier,
          phase,
          expectedPauseEpoch: pauseEpoch,
          expectedTurn: identity,
        });
      } else {
        const { executeTimedOutTurn } = await import("./timeoutExecutor");
        await executeTimedOutTurn({
          roomCode,
          userId,
          phase,
          expectedPauseEpoch: pauseEpoch,
          expectedTurn: identity,
        });
      }
    },
    onFailed: async (error) => {
      logger.warn(
        { err: error, roomCode, userId, phase, identity },
        "turn_execution_failed",
      );
      try {
        const { recoverRoomRuntime } = await import("./recovery");
        await recoverRoomRuntime(roomCode);
      } catch (recoveryError) {
        logger.warn(
          { err: recoveryError, roomCode },
          "turn_execution_recovery_failed",
        );
      }
    },
  });

  publishEvent(roomCode, "turn_timer_started", {
    turnUserId: userId,
    totalMs: isBot ? null : durationMs,
    serverTimestamp: Date.now(),
    phase,
    isBot,
  });
}

export function clearRuntimeRoom(roomCode: string): void {
  clearTurnTimer(roomCode);
  clearTimeoutPolicy(roomCode);
  clearBotSeats(roomCode);
}

export function clearAllRuntime(): void {
  clearAllTurnTimers();
  clearAllTimeoutPolicy();
  clearAllBotSeats();
}
