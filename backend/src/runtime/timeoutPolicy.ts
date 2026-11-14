import { roundDealTimes } from "../gameConfig";
import type { LiveGame } from "../game/liveGame";
import type { TurnPhase } from "../contract/game";

function turnDurationMs(phase: TurnPhase): number {
  const seconds =
    phase === "choose_briscola"
      ? process.env.BRISCOLA_TIMEOUT_SECONDS || "90"
      : process.env.TURN_TIMEOUT_SECONDS || "60";
  return parseInt(seconds, 10) * 1000;
}

export function botThinkDelayMs(): number {
  return parseInt(process.env.BOT_THINK_DELAY_MS || "1000", 10);
}

// Epoch milliseconds of the current turn, for the timer and the clients alike.
// Clients block the briscola choice until the deal is shown, so that time is not the caller's.
export function turnTimes(game: Pick<LiveGame, "room" | "round">, phase: TurnPhase, now: number) {
  const startedAt = Math.max(
    game.room.turnStartedAt?.getTime() ?? now,
    phase === "choose_briscola" ? roundDealTimes(game.round!).reviewEndsAt : 0,
  );
  return { startedAt, deadline: startedAt + turnDurationMs(phase) };
}
