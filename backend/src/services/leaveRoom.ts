import { prisma } from "../db";
import { GameError } from "../utils/gameError";
import { retirePracticeRoom } from "./practiceRooms";
import { logger } from "../logger";
import { publishEvent } from "../runtime/eventPublisher";
import { withRoomLock } from "../utils/roomLock";
import { changePlayerControlUnlocked } from "./playerControl";
import { PUBLIC_PLAYER_SELECT } from "../domain/publicPlayer";

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
    publishEvent(args.roomCode, "practice_abandoned", {
      roomCode: args.roomCode,
    });
    publishEvent("lobby", "practice_abandoned", {
      roomCode: args.roomCode,
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
    const remainingRoom = await prisma.$transaction(async (tx) => {
      await tx.player.delete({ where: { id: player.id } });
      await tx.player.updateMany({
        where: { gameRoomId: room.id },
        data: { isReady: false },
      });
      return tx.gameRoom.findUniqueOrThrow({
        where: { id: room.id },
        include: { players: { select: PUBLIC_PLAYER_SELECT } },
      });
    });
    publishEvent(args.roomCode, "player_left", { userId: args.userId });
    publishEvent(args.roomCode, "room_settings_changed", { room: remainingRoom });
    publishEvent("lobby", "room_updated", {
      roomCode: args.roomCode,
      currentPlayers: remainingRoom.players.length,
    });
    return { success: true, deletedRoom: false };
  });
  if (result.deletedRoom) {
    publishEvent("lobby", "room_deleted", { roomCode: args.roomCode });
  }
  return result;
}
