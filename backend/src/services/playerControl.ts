import { prisma } from "../db";
import { GameError } from "../utils/gameError";
import { withRoomLock } from "../utils/roomLock";
import { replacementBotTier } from "./botUsers";
import { clearTurnTimer, getTurnTimerState } from "../runtime/turnTimer";
import { recoverRoomRuntimeUnlocked } from "../runtime/recovery";
import { markGameChanged, sendGameState } from "./gameState";
import { logger } from "../logger";
import type { BotTier } from "../contract/cards";

type PlayerControlChange = {
  roomCode: string;
  userId: number;
  action: "abandon" | "resume" | "timeout";
};

export function changePlayerControl(args: PlayerControlChange) {
  return withRoomLock(args.roomCode, () => changePlayerControlUnlocked(args));
}

// Callers must hold the room lock through persistence and runtime handoff.
export async function changePlayerControlUnlocked(args: PlayerControlChange) {
  const room = await prisma.gameRoom.findUnique({
    where: { code: args.roomCode },
    include: { players: { include: { user: { select: { username: true, isBot: true } } } } },
  });
  if (!room) throw new GameError("Room not found", 404);
  const player = room.players.find((candidate) => candidate.userId === args.userId);
  if (!player || player.user.isBot) throw new GameError("Player not in this room", 403);
  if (args.action === "resume" && player.abandonedAt) {
    throw new GameError("Hai abbandonato questa partita: non puoi riprendere il controllo", 403);
  }
  if (!room.started || room.finished) return { success: true };
  if (args.action === "abandon" && room.isPractice) {
    throw new GameError("Use practice abandonment for this room", 400);
  }
  // Practice has one human: a bot takeover would leave nobody to archive the match as.
  if (
    args.action === "timeout" &&
    (room.isPractice || player.botModel !== null || player.timeoutCount < 3)
  ) {
    return { success: true };
  }

  const botModel = args.action === "resume" ? null : replacementBotTier(room);
  const abandonedAt = args.action === "abandon"
    ? player.abandonedAt ?? new Date()
    : player.abandonedAt;
  if (player.botModel === botModel && player.abandonedAt === abandonedAt) {
    await recoverRoomRuntimeUnlocked(room.code);
    return { success: true };
  }
  await prisma.$transaction(async (tx) => {
    await tx.player.update({
      where: { id: player.id },
      data: { botModel, abandonedAt, ...(args.action === "resume" ? { timeoutCount: 0 } : {}) },
    });
    await markGameChanged(tx, room.id);
  });
  if (getTurnTimerState(room.code)?.turnUserId === player.userId) {
    clearTurnTimer(room.code);
  }
  await recoverRoomRuntimeUnlocked(room.code);
  await sendGameState(
    room.code,
    args.action === "abandon"
      ? { kind: "abandoned", userId: player.userId }
      : { kind: "control_changed", userId: player.userId, botModel: botModel as BotTier | null },
  );
  logger.info(
    { roomCode: room.code, action: args.action, userId: player.userId, botModel, abandonedAt },
    "player_control_changed",
  );
  return { success: true };
}
