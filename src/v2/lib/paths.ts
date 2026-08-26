// Single source of truth for every V2 URL. Nothing in src/v2 may link to a V1 path.
export const V2_ROOT = "/v2";

export const v2Path = {
  lobby: () => V2_ROOT,
  room: (code: string) => `${V2_ROOT}/room/${code}`,
  game: (code: string) => `${V2_ROOT}/game/${code}`,
  practice: () => `${V2_ROOT}/practice`,
  profile: () => `${V2_ROOT}/profile`,
  leaderboard: () => `${V2_ROOT}/leaderboard`,
  annotate: () => `${V2_ROOT}/annotate`,
};

export function v2InviteUrl(code: string): string {
  return `${window.location.origin}${v2Path.room(code)}`;
}
