import { prisma } from "../db";
import { logger } from "../logger";
import { withRoomLock } from "../utils/roomLock";
import { deleteRoomAndPlay } from "./roomCommands";
import { clearRuntimeRoom } from "../runtime/turnRuntime";

const PRACTICE_ROOM_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

let interval: NodeJS.Timeout | null = null;
let activeSweep: Promise<number> | null = null;

function isEligibleForDeletion(
  room: {
    isPractice: boolean;
    finished: boolean;
    lastActivityAt: Date;
  },
  staleBefore: Date,
): boolean {
  return (
    room.isPractice &&
    (room.finished || room.lastActivityAt.getTime() <= staleBefore.getTime())
  );
}

async function runPracticeRoomSweep(now: Date): Promise<number> {
  const staleBefore = new Date(now.getTime() - PRACTICE_ROOM_MAX_AGE_MS);
  const candidates = await prisma.gameRoom.findMany({
    where: {
      isPractice: true,
      OR: [
        { finished: true },
        { lastActivityAt: { lte: staleBefore } },
      ],
    },
    select: { id: true, code: true },
    orderBy: [{ lastActivityAt: "asc" }, { id: "asc" }],
  });
  let deletedRooms = 0;

  for (const candidate of candidates) {
    try {
      await withRoomLock(candidate.code, async () => {
        const room = await prisma.gameRoom.findUnique({
          where: { code: candidate.code },
          select: {
            id: true,
            code: true,
            isPractice: true,
            finished: true,
            lastActivityAt: true,
          },
        });
        if (!room || !isEligibleForDeletion(room, staleBefore)) return;

        clearRuntimeRoom(room.code);
        await deleteRoomAndPlay(room.id);
        deletedRooms += 1;
      });
    } catch (error) {
      logger.error(
        {
          err: error,
          roomCode: candidate.code,
          gameRoomId: candidate.id,
        },
        "practice_room_sweep_room_failed",
      );
    }
  }

  if (deletedRooms > 0) {
    logger.info({ deletedRooms }, "practice_rooms_swept");
  }
  return deletedRooms;
}

export function sweepPracticeRooms(now: Date = new Date()): Promise<number> {
  if (activeSweep) return activeSweep;

  const sweep = runPracticeRoomSweep(now).finally(() => {
    if (activeSweep === sweep) activeSweep = null;
  });
  activeSweep = sweep;
  return sweep;
}

function scheduleSweep(): void {
  void sweepPracticeRooms().catch((error) => {
    logger.error({ err: error }, "practice_room_sweep_failed");
  });
}

export function startPracticeRoomSweeper(): void {
  if (interval) return;

  scheduleSweep();
  interval = setInterval(scheduleSweep, SWEEP_INTERVAL_MS);
  interval.unref();
}

export async function stopPracticeRoomSweeper(): Promise<void> {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  if (activeSweep) {
    await activeSweep.catch(() => undefined);
  }
}
