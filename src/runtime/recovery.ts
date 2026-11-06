import { prisma } from "../db";
import { logger } from "../logger";
import {
  readCallerPlayerId,
  readCurrentTurn,
} from "../game/snapshots/turnState";
import { restoreBotSeats } from "./botRegistry";
import { startRuntimeTurn } from "./turnRuntime";
import { clearTurnTimer, hasTurnRuntime } from "./turnTimer";
import { withRoomLock } from "../utils/roomLock";
import { roundDealPresentation } from "../gameConfig";
import { replacementBotTier } from "../services/botUsers";

export type RuntimeRecoverySummary = {
  activeRooms: number;
  recoveredRooms: number;
  failedRoomCodes: string[];
};

let runtimeRecoveryReady = process.env.NODE_ENV === "test";

export function isRuntimeRecoveryReady(): boolean {
  return runtimeRecoveryReady;
}

export function setRuntimeRecoveryReady(ready: boolean): void {
  runtimeRecoveryReady = ready;
}

export async function recoverRoomRuntime(
  roomCode: string,
): Promise<boolean> {
  return withRoomLock(roomCode, () => recoverRoomRuntimeUnlocked(roomCode));
}

export async function recoverRoomRuntimeUnlocked(
  roomCode: string,
): Promise<boolean> {
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
  if (!room || !room.started || room.finished || room.pausedAt) return false;
  if (!round) throw new Error("Active room has no current round");

  const callerPlayerId = await readCallerPlayerId(round, room.players);
  const turn = await readCurrentTurn(round, room.players, callerPlayerId);
  if (!turn) throw new Error("Active room has no current turn");

  // Finish a takeover if the process stopped after committing the third timeout.
  const overdue = room.isPractice
    ? []
    : room.players.filter((player) => player.botModel === null && player.timeoutCount >= 3);
  if (overdue.length > 0) {
    const tier = replacementBotTier(room);
    await prisma.player.updateMany({
      where: { id: { in: overdue.map((player) => player.id) } },
      data: { botModel: tier },
    });
    overdue.forEach((player) => { player.botModel = tier; });
    if (overdue.some((player) => player.userId === turn.userId)) clearTurnTimer(roomCode);
    logger.warn({ roomCode, userIds: overdue.map((player) => player.userId) }, "timeout_takeover_recovered");
  }

  restoreBotSeats(roomCode, room.players);
  if (hasTurnRuntime(roomCode, turn.userId, turn.phase, room.pauseEpoch, turn.identity)) {
    return false;
  }

  startRuntimeTurn(
    roomCode,
    turn.userId,
    turn.phase,
    room.pauseEpoch,
    turn.identity,
    turn.phase === "choose_briscola" ? roundDealPresentation(round).remainingMs : 0,
  );
  logger.info(
    { roomCode, userId: turn.userId, phase: turn.phase },
    "turn_runtime_recovered",
  );
  return true;
}

export async function recoverRooms(
  roomCodes: readonly string[],
  recover: (roomCode: string) => Promise<boolean> = recoverRoomRuntime,
): Promise<RuntimeRecoverySummary> {
  let recoveredRooms = 0;
  const failedRoomCodes: string[] = [];
  for (const roomCode of roomCodes) {
    try {
      if (await recover(roomCode)) recoveredRooms++;
    } catch (error) {
      failedRoomCodes.push(roomCode);
      logger.error({ err: error, roomCode }, "room_runtime_recovery_failed");
    }
  }
  return {
    activeRooms: roomCodes.length,
    recoveredRooms,
    failedRoomCodes,
  };
}

export async function reconcileActiveRuntime(): Promise<RuntimeRecoverySummary> {
  try {
    const rooms = await prisma.gameRoom.findMany({
      where: {
        started: true,
        finished: false,
        pausedAt: null,
      },
      select: { code: true },
      orderBy: { id: "asc" },
    });
    const summary = await recoverRooms(rooms.map((room) => room.code));
    setRuntimeRecoveryReady(summary.failedRoomCodes.length === 0);
    return summary;
  } catch (error) {
    setRuntimeRecoveryReady(false);
    throw error;
  }
}
