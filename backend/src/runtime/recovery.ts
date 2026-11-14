import { prisma } from "../db";
import { logger } from "../logger";
import { loadLiveGame } from "../game/liveGame";
import { armTurn } from "./turnRuntime";
import { hasTurnRuntime } from "./turnTimer";
import { withRoomLock } from "../utils/roomLock";

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

// Arms a live game whose timer is missing or armed for another version.
export function recoverRoomRuntime(roomCode: string): Promise<boolean> {
  return withRoomLock(roomCode, async () => {
    const game = await loadLiveGame(prisma, roomCode);
    const { room } = game;
    if (!room.started || room.finished || room.pausedAt) return false;
    if (hasTurnRuntime(roomCode, room.version)) return false;
    armTurn(game);
    logger.info({ roomCode, version: room.version }, "turn_runtime_recovered");
    return true;
  });
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
