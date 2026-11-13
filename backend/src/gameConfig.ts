import { logger } from "./logger";

export const TRICK_DISPLAY_MS = 3_000;

export function roundDealPresentation(
  round: { number: number; createdAt: Date },
  now = Date.now(),
) {
  const animationMs = 2_400;
  const reviewMs = 1_600;
  const summaryMs = round.number > 1 ? 4_000 : 0;
  return {
    remainingMs: Math.max(
      0,
      round.createdAt.getTime() + summaryMs + animationMs + reviewMs - now,
    ),
    animationMs,
    reviewMs,
  };
}

export const GAME_WIN_POINTS = (() => {
  const parsed = parseInt(process.env.GAME_WIN_POINTS || "41", 10);
  if (isNaN(parsed) || parsed < 1) {
    logger.warn(
      { value: process.env.GAME_WIN_POINTS },
      "invalid_game_win_points_defaulting_to_41",
    );
    return 41;
  }
  return parsed;
})();
