import { GameError } from "../utils/gameError";
import { runGameAction } from "../game/runGameAction";
import { logger } from "../logger";

// The seat owner takes the seat back from the bot.
export async function resumePlayerControl(roomCode: string, userId: number) {
  await runGameAction(roomCode, async (game, tx) => {
    const player = game.players.find((candidate) => candidate.userId === userId);
    if (!player || player.isBot) throw new GameError("Player not in this room", 403);
    if (player.abandonedAt) {
      throw new GameError("Hai abbandonato questa partita: non puoi riprendere il controllo", 403);
    }
    if (!game.room.started || game.room.finished || player.botModel === null) return null;
    await tx.player.update({ where: { id: player.id }, data: { botModel: null, timeoutCount: 0 } });
    logger.info({ roomCode, userId }, "player_control_resumed");
    return { kind: "control_changed", userId, botModel: null };
  }, userId);
  return { success: true };
}
