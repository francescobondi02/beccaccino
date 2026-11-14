import { prisma } from "../db";
import { logger } from "../logger";
import { retirePracticeRoom } from "./practiceRooms";

const PRACTICE_ROOM_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

let interval: NodeJS.Timeout | null = null;
let activeSweep: Promise<number> | null = null;

async function runPracticeRoomSweep(now: Date): Promise<number> {
  const staleBefore = new Date(now.getTime() - PRACTICE_ROOM_MAX_AGE_MS);
  const candidates = await prisma.gameRoom.findMany({
    where: {
      isPractice: true,
      finished: false,
      lastActivityAt: { lte: staleBefore },
    },
    select: { code: true },
    orderBy: [{ lastActivityAt: "asc" }, { id: "asc" }],
  });
  let retiredRooms = 0;

  for (const candidate of candidates) {
    try {
      const retired = await retirePracticeRoom(candidate.code, staleBefore);
      if (retired) retiredRooms += 1;
    } catch (error) {
      logger.error({ err: error, roomCode: candidate.code }, "practice_room_sweep_room_failed");
    }
  }

  if (retiredRooms > 0) {
    logger.info({ retiredRooms }, "practice_rooms_swept");
  }
  return retiredRooms;
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
