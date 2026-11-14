import { logger } from "./logger";

export const TRICK_DISPLAY_MS = 3_000;

// Epoch milliseconds: the previous round's summary, then the deal animation, then time to read the hand.
export function roundDealTimes(round: { number: number; createdAt: Date }) {
  const summaryEndsAt = round.createdAt.getTime() + (round.number > 1 ? 4_000 : 0);
  const animationEndsAt = summaryEndsAt + 2_400;
  return { summaryEndsAt, animationEndsAt, reviewEndsAt: animationEndsAt + 1_600 };
}

export function roundDealRemainingMs(
  round: { number: number; createdAt: Date },
  now = Date.now(),
) {
  return Math.max(0, roundDealTimes(round).reviewEndsAt - now);
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
