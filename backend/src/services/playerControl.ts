import { GameError } from "../utils/gameError";
import { withRoomLock } from "../utils/roomLock";
import { replacementBotTier } from "./botUsers";
import { runGameActionUnlocked } from "../game/runGameAction";
import { logger } from "../logger";
import type { BotTier } from "../contract/cards";

type PlayerControlChange = {
  roomCode: string;
  userId: number;
  action: "abandon" | "resume";
};

export function changePlayerControl(args: PlayerControlChange) {
  return withRoomLock(args.roomCode, () => changePlayerControlUnlocked(args));
}

// Callers hold the room lock.
export async function changePlayerControlUnlocked(args: PlayerControlChange) {
  await runGameActionUnlocked(args.roomCode, async (game, tx) => {
    const player = game.players.find((candidate) => candidate.userId === args.userId);
    if (!player || player.isBot) throw new GameError("Player not in this room", 403);
    if (args.action === "resume" && player.abandonedAt) {
      throw new GameError("Hai abbandonato questa partita: non puoi riprendere il controllo", 403);
    }
    if (!game.room.started || game.room.finished) return null;
    if (args.action === "abandon" && game.room.isPractice) {
      throw new GameError("Use practice abandonment for this room", 400);
    }
    if (args.action === "abandon" ? player.abandonedAt : player.botModel === null) return null;

    const botModel =
      args.action === "resume"
        ? null
        : replacementBotTier({ botTier: game.room.botTier, players: game.players });
    await tx.player.update({
      where: { id: player.id },
      data:
        args.action === "resume"
          ? { botModel, timeoutCount: 0 }
          : { botModel, abandonedAt: new Date() },
    });
    logger.info({ roomCode: args.roomCode, action: args.action, userId: args.userId, botModel }, "player_control_changed");
    return args.action === "abandon"
      ? { kind: "abandoned", userId: args.userId }
      : { kind: "control_changed", userId: args.userId, botModel: botModel as BotTier | null };
  });
  return { success: true };
}
