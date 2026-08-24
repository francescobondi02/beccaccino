import { logger } from "./logger";

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
