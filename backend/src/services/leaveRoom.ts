import { prisma } from "../db";
import { GameError } from "../utils/gameError";
import { retirePracticeRoom } from "./practiceRooms";
import { logger } from "../logger";
import { publishRoomChanged } from "../runtime/eventPublisher";
import { withRoomLock } from "../utils/roomLock";
import { changePlayerControlUnlocked } from "./playerControl";

function assertWaiting(onlyIfWaiting: boolean | undefined, started: boolean) {
  if (onlyIfWaiting && started) {
    throw new GameError("La partita è già iniziata", 409);
  }
}

export async function leaveRoom(args: {
  roomCode: string;
  userId: number;
  onlyIfWaiting?: boolean;
}) {
  const room = await prisma.gameRoom.findUnique({
    where: { code: args.roomCode },
    select: { isPractice: true, started: true },
  });
  if (!room) throw new GameError("Room not found", 404);
  assertWaiting(args.onlyIfWaiting, room.started);

  if (room.isPractice) {
    await retirePracticeRoom({
      roomCode: args.roomCode,
      reason: { kind: "participant_leave", userId: args.userId },
    });
    logger.info(args, "practice_game_abandoned");
    return { success: true, deletedRoom: true };
  }
  const result = await withRoomLock(args.roomCode, async () => {
    const room = await prisma.gameRoom.findUnique({
      where: { code: args.roomCode },
      include: { players: true },
    });
    if (!room || room.isPractice) throw new GameError("Room not found", 404);

    const player = room.players.find(
      (candidate) => candidate.userId === args.userId,
    );
    if (!player) throw new GameError("Player not found in room", 404);
    assertWaiting(args.onlyIfWaiting, room.started);
    if (room.started && !room.finished) {
      await changePlayerControlUnlocked({ ...args, action: "abandon" });
      return { success: true, deletedRoom: false, preservedHistory: true, abandoned: true };
    }
    if (room.finished) {
      return {
        success: true,
        deletedRoom: false,
        preservedHistory: true,
      };
    }
    if (room.players.length === 1) {
      await prisma.$transaction([
        prisma.player.deleteMany({ where: { gameRoomId: room.id } }),
        prisma.gameRoom.delete({ where: { id: room.id } }),
      ]);
      return { success: true, deletedRoom: true };
    }

    // Like a bot-tier change, a new line-up must be confirmed again.
    await prisma.$transaction([
      prisma.player.delete({ where: { id: player.id } }),
      prisma.player.updateMany({
        where: { gameRoomId: room.id },
        data: { isReady: false },
      }),
    ]);
    return { success: true, deletedRoom: false };
  });
  publishRoomChanged(args.roomCode);
  return result;
}
