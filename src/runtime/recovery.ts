import { prisma } from "../db";
import { logger } from "../logger";
import {
  readCallerPlayerId,
  readCurrentTurnUserId,
} from "../game/snapshots/turnState";
import {
  restoreBotSeats,
} from "./botRegistry";
import { applyRuntimeDirective } from "./turnRuntime";
import { hasScheduledTurn } from "./turnTimer";
import { withRoomLock } from "../utils/roomLock";

export async function recoverRoomRuntime(roomCode: string): Promise<boolean> {
  return withRoomLock(roomCode, async () => {
    const room = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: {
        players: true,
        rounds: {
          orderBy: { number: "desc" },
          take: 1,
        },
      },
    });
    const round = room?.rounds[0];
    if (
      !room ||
      !round ||
      !room.started ||
      room.finished ||
      room.pausedAt
    ) {
      return false;
    }

    const callerPlayerId = await readCallerPlayerId(round, room.players);
    const userId = await readCurrentTurnUserId(
      round,
      room.players,
      callerPlayerId,
    );
    if (userId === null) return false;

    const phase =
      round.briscola === null ? "choose_briscola" : "play_card";
    if (hasScheduledTurn(roomCode, userId, phase, room.pauseEpoch)) {
      return false;
    }

    restoreBotSeats(roomCode, room.players);
    applyRuntimeDirective({
      kind: "schedule",
      roomCode,
      userId,
      phase,
      pauseEpoch: room.pauseEpoch,
    });
    logger.info({ roomCode, userId, phase }, "turn_runtime_recovered");
    return true;
  });
}

export async function recoverActiveRuntime(): Promise<number> {
  const rooms = await prisma.gameRoom.findMany({
    where: {
      started: true,
      finished: false,
      pausedAt: null,
    },
    select: { code: true },
    orderBy: { id: "asc" },
  });

  let recovered = 0;
  for (const room of rooms) {
    if (await recoverRoomRuntime(room.code)) recovered++;
  }
  return recovered;
}
