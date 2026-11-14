import { prisma } from "../db";
import { GameError } from "../utils/gameError";
import { retirePracticeRoomUnlocked } from "./practiceRooms";
import { logger } from "../logger";
import { publishRoomChanged } from "../runtime/eventPublisher";
import { withRoomLock } from "../utils/roomLock";
import { changePlayerControlUnlocked } from "./playerControl";

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

    if (room.isPractice) {
      await retirePracticeRoomUnlocked(room.code);
      logger.info(args, "practice_game_abandoned");
      return { deletedRoom: !room.started };
    }
    if (room.started && !room.finished) {
      await changePlayerControlUnlocked({ ...args, action: "abandon" });
      return { deletedRoom: false };
    }
    if (room.finished) return { deletedRoom: false };
    if (room.players.length === 1) {
      await prisma.$transaction([
        prisma.player.deleteMany({ where: { gameRoomId: room.id } }),
        prisma.gameRoom.delete({ where: { id: room.id } }),
      ]);
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
