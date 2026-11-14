import type { TurnPhase } from "../contract/game";

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
