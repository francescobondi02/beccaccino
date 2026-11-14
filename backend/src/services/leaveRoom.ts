import { prisma } from "../db";
import { GameError } from "../utils/gameError";
import { deleteRoom } from "./practiceRooms";
import { replacementBotTier } from "./botUsers";
import { logger } from "../logger";
import { publishRoomChanged } from "../runtime/eventPublisher";
import { runGameActionUnlocked } from "../game/runGameAction";
import { withRoomLock } from "../utils/roomLock";

// Started games are kept: a practice game closes, a multiplayer seat goes to a bot.
export async function leaveRoom(args: {
  roomCode: string;
  userId: number;
  onlyIfWaiting?: boolean;
}): Promise<{ deletedRoom: boolean }> {
  const result = await withRoomLock(args.roomCode, async () => {
    const room = await prisma.gameRoom.findUnique({
      where: { code: args.roomCode },
      include: { players: true },
    });
    if (!room) throw new GameError("Room not found", 404);
    const player = room.players.find((candidate) => candidate.userId === args.userId);
    if (!player) throw new GameError("Player not found in room", 404);
    if (args.onlyIfWaiting && room.started) {
      throw new GameError("La partita è già iniziata", 409);
    }

    if (room.started) {
      if (!room.finished) {
        await runGameActionUnlocked(args.roomCode, async (game, tx) => {
          if (game.room.isPractice) {
            await tx.gameRoom.update({
              where: { id: game.room.id },
              data: { finished: true, winnerTeam: null },
            });
          } else {
            if (player.abandonedAt) return null;
            await tx.player.update({
              where: { id: player.id },
              data: {
                botModel: replacementBotTier({ botTier: game.room.botTier, players: game.players }),
                abandonedAt: new Date(),
              },
            });
          }
          logger.info(args, "player_abandoned_game");
          return { kind: "abandoned", userId: args.userId };
        }, args.userId);
      }
      return { deletedRoom: false };
    }
    if (room.isPractice || room.players.length === 1) {
      await deleteRoom(room.id);
      return { deletedRoom: true };
    }

    // Like a bot-tier change, a new line-up must be confirmed again.
    await prisma.$transaction([
      prisma.player.delete({ where: { id: player.id } }),
      prisma.player.updateMany({
        where: { gameRoomId: room.id },
        data: { isReady: false },
      }),
    ]);
    return { deletedRoom: false };
  });
  publishRoomChanged(args.roomCode);
  return result;
}
