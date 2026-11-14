// Shared filters for anything that aggregates over games (leaderboard, profile
// stats, ops metrics). Practice games against bots must never count: they are
// unranked training, and a human can farm them at will.

/** Finished multiplayer games with a winner count toward a player's public record. */
export const RANKED_FINISHED_GAME = {
  finished: true,
  isPractice: false,
  winnerTeam: { not: null },
} as const;

/** Rooms considered "live" for ops metrics — excludes practice sessions. */
export const LIVE_MULTIPLAYER_ROOM = { started: true, finished: false, isPractice: false } as const;

/** Open lobbies awaiting players. Practice rooms are never joinable. */
export const OPEN_LOBBY = { started: false, isPractice: false } as const;
