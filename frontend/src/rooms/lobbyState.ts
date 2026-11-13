import type { Room } from "@contract/rooms";

export function splitActiveGames(activeGames: Room[]) {
  const pausedPracticeGames: Room[] = [];
  const ordinaryActiveGames: Room[] = [];

  activeGames.forEach((game) => {
    if (game.isPractice && game.pausedAt) {
      pausedPracticeGames.push(game);
    } else {
      ordinaryActiveGames.push(game);
    }
  });

  return { pausedPracticeGames, ordinaryActiveGames };
}
