import { RuntimeDirective, TurnPhase } from "../game/transitions/types";
import { publishEvent } from "./eventPublisher";
import {
  botRoomCodes,
  botTierForTurn,
  clearAllBotSeats,
  clearBotSeats,
} from "./botRegistry";
import {
  botThinkDelayMs,
  clearAllTimeoutPolicy,
  clearTimeoutPolicy,
  isPlayerKicked,
  timeoutPolicyRoomCodes,
  turnDurationMs,
} from "./timeoutPolicy";
import {
  activeTimerRoomCodes,
  clearAllTurnTimers,
  clearTurnTimer,
  scheduleTurnTimer,
} from "./turnTimer";

export function startRuntimeTurn(
  roomCode: string,
  userId: number,
  phase: TurnPhase,
  pauseEpoch: number,
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
        });
      } else {
        const { executeTimedOutTurn } = await import("./timeoutExecutor");
        await executeTimedOutTurn({
          roomCode,
          userId,
          phase,
          expectedPauseEpoch: pauseEpoch,
        });
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

export function applyRuntimeDirective(
  directive: RuntimeDirective | null,
): void {
  if (!directive) return;
  if (directive.kind === "clear") {
    clearRuntimeRoom(directive.roomCode);
    return;
  }
  startRuntimeTurn(
    directive.roomCode,
    directive.userId,
    directive.phase,
    directive.pauseEpoch,
  );
}

export function clearRuntimeRoom(roomCode: string): void {
  clearTurnTimer(roomCode);
  clearTimeoutPolicy(roomCode);
  clearBotSeats(roomCode);
}

export function clearAllRuntime(): void {
  const roomCodes = new Set([
    ...activeTimerRoomCodes(),
    ...timeoutPolicyRoomCodes(),
    ...botRoomCodes(),
  ]);
  for (const roomCode of roomCodes) clearRuntimeRoom(roomCode);
  clearAllTurnTimers();
  clearAllTimeoutPolicy();
  clearAllBotSeats();
}
