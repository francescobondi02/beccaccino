import { prisma } from "../db";
import { logger } from "../logger";
import { readCurrentTurn } from "../game/snapshots/turnState";
import { restoreBotSeats } from "./botRegistry";
import { startRuntimeTurn } from "./turnRuntime";
import { clearTurnTimer, hasTurnRuntime } from "./turnTimer";
import { withRoomLock } from "../utils/roomLock";
import { roundDealRemainingMs } from "../gameConfig";
import { replacementBotTier } from "../services/botUsers";
import { markGameChanged, sendGameState } from "../services/gameState";

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

  const turn = await readCurrentTurn(round, room.players);
  if (!turn) throw new Error("Active room has no current turn");

  // Finish a takeover if the process stopped after committing the third timeout.
  const overdue = room.isPractice
    ? []
    : room.players.filter((player) => player.botModel === null && player.timeoutCount >= 3);
  const tier = overdue.length > 0 ? replacementBotTier(room) : null;
  if (overdue.length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.player.updateMany({
        where: { id: { in: overdue.map((player) => player.id) } },
        data: { botModel: tier },
      });
      await markGameChanged(tx, room.id);
    });
    overdue.forEach((player) => { player.botModel = tier; });
    if (overdue.some((player) => player.userId === turn.userId)) clearTurnTimer(roomCode);
    logger.warn({ roomCode, userIds: overdue.map((player) => player.userId) }, "timeout_takeover_recovered");
  }

  restoreBotSeats(roomCode, room.players);
  const recovered = !hasTurnRuntime(roomCode, turn.userId, turn.phase, room.pauseEpoch, turn.identity);
  if (recovered) {
    startRuntimeTurn(
      roomCode,
      turn.userId,
      turn.phase,
      room.pauseEpoch,
      turn.identity,
      turn.phase === "choose_briscola" ? roundDealRemainingMs(round) : 0,
    );
    logger.info(
      { roomCode, userId: turn.userId, phase: turn.phase },
      "turn_runtime_recovered",
    );
  }
  for (const player of overdue) {
    await sendGameState(roomCode, { kind: "control_changed", userId: player.userId, botModel: tier });
  }
  return recovered;
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
