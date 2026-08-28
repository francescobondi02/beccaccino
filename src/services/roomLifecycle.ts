import { prisma } from "../db";
import { GameError } from "../utils/gameError";
import {
  leaveMultiplayerRoomCommand,
  MultiplayerLeaveResult,
} from "./multiplayerRoomCommands";
import { retirePracticeRoom } from "./practiceRoomCommands";

export type LeaveRoomResult =
  | { kind: "practice_deleted" }
  | MultiplayerLeaveResult;

export async function leaveRoomCommand(args: {
  roomCode: string;
  userId: number;
}): Promise<LeaveRoomResult> {
  const room = await prisma.gameRoom.findUnique({
    where: { code: args.roomCode },
    select: { isPractice: true },
  });
  if (!room) throw new GameError("Room not found", 404);

  if (room.isPractice) {
    await retirePracticeRoom({
      roomCode: args.roomCode,
      reason: { kind: "participant_leave", userId: args.userId },
    });
    return { kind: "practice_deleted" };
  }
  return leaveMultiplayerRoomCommand(args);
}
