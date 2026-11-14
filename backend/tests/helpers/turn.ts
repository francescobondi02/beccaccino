import { prisma } from "../../src/db";
import { currentTurn } from "../../src/domain/game/turnOrder";
import { loadLiveGame } from "../../src/game/liveGame";
import { toGameState } from "../../src/game/gameState";
import { isBotTier } from "../../src/services/botUsers";

// The persisted turn of a live game, or null when nobody has to act.
export async function turnOf(roomCode: string) {
  const game = await loadLiveGame(prisma, roomCode);
  const turn = currentTurn(game);
  return turn && {
    userId: turn.player.userId,
    phase: turn.phase,
    isBot: isBotTier(turn.player.botModel),
    version: game.room.version,
  };
}

export async function playableOf(roomCode: string, userId: number) {
  const game = await loadLiveGame(prisma, roomCode);
  return toGameState(game, userId, Date.now(), null).playableCards;
}
