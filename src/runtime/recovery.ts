import { prisma } from "../db";
import { logger } from "../logger";
import {
  readCallerPlayerId,
  readCurrentTurn,
} from "../game/snapshots/turnState";
import { restoreBotSeats } from "./botRegistry";
import { applyRuntimeDirective } from "./turnRuntime";
import { hasTurnRuntime } from "./turnTimer";
import { withRoomLock } from "../utils/roomLock";

type RoomRuntimeState = {
  active: boolean;
  recovered: boolean;
};

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

async function reconcileRoomRuntime(
  roomCode: string,
): Promise<RoomRuntimeState> {
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
      !room.started ||
      room.finished ||
      room.pausedAt
    ) {
      return { active: false, recovered: false };
    }
    if (!round) {
      throw new Error("Active room has no current round");
    }

    const callerPlayerId = await readCallerPlayerId(round, room.players);
    const turn = await readCurrentTurn(
      round,
      room.players,
      callerPlayerId,
    );
    if (!turn) {
      throw new Error("Active room has no current turn");
    }

    if (
      hasTurnRuntime(
        roomCode,
        turn.userId,
        turn.phase,
        room.pauseEpoch,
        turn.identity,
      )
    ) {
      return { active: true, recovered: false };
    }

    restoreBotSeats(roomCode, room.players);
    applyRuntimeDirective({
      kind: "schedule",
      roomCode,
      userId: turn.userId,
      phase: turn.phase,
      pauseEpoch: room.pauseEpoch,
      identity: turn.identity,
    });
    logger.info(
      { roomCode, userId: turn.userId, phase: turn.phase },
      "turn_runtime_recovered",
    );
    return { active: true, recovered: true };
  });
}

export async function recoverRoomRuntime(roomCode: string): Promise<boolean> {
  return (await reconcileRoomRuntime(roomCode)).recovered;
}

export async function ensureRoomRuntime(roomCode: string): Promise<boolean> {
  return (await reconcileRoomRuntime(roomCode)).active;
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
