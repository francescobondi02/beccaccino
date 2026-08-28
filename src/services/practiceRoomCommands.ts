import { prisma } from "../db";
import { registerBotSeats } from "../runtime/botRegistry";
import { clearRuntimeRoom } from "../runtime/turnRuntime";
import { clearTurnTimer } from "../runtime/turnTimer";
import { GameError } from "../utils/gameError";
import { withRoomLock } from "../utils/roomLock";
import { ensureBotServiceReady } from "./botClient";
import { BotTier, ensureBotUsers } from "./botService";
import { archivePracticeMatch } from "./practiceArchive";
import { generateUniqueRoomCode } from "./roomCode";
import { assertNoActiveMultiplayerGame } from "./roomQueries";
import { startFirstRound } from "./turnCoordinator";

class PracticeRoomCleanupError extends Error {
  constructor(
    readonly creationError: unknown,
    readonly cleanupError: unknown,
  ) {
    super("Practice room creation failed and cleanup was unsuccessful");
    this.name = "PracticeRoomCleanupError";
  }
}

export type PracticeRetirementReason =
  | { kind: "participant_leave"; userId: number }
  | { kind: "stale"; staleBefore: Date }
  | { kind: "failed_creation"; gameRoomId: number };

function isStalePracticeRoom(
  room: {
    finished: boolean;
    lastActivityAt: Date;
  },
  staleBefore: Date,
): boolean {
  return (
    room.finished ||
    room.lastActivityAt.getTime() <= staleBefore.getTime()
  );
}

export async function retirePracticeRoom(args: {
  roomCode: string;
  reason: PracticeRetirementReason;
}): Promise<boolean> {
  const reason = args.reason;
  return withRoomLock(args.roomCode, async () => {
    const room = await prisma.gameRoom.findUnique({
      where: { code: args.roomCode },
      include: { players: { select: { userId: true } } },
    });
    if (!room) {
      if (reason.kind === "participant_leave") {
        throw new GameError("Room not found", 404);
      }
      return false;
    }
    if (!room.isPractice) {
      throw new GameError("Only practice rooms can be retired", 409);
    }

    if (reason.kind === "participant_leave") {
      if (
        !room.players.some(
          (player) => player.userId === reason.userId,
        )
      ) {
        throw new GameError("Player not found in room", 404);
      }
    } else if (reason.kind === "stale") {
      if (!isStalePracticeRoom(room, reason.staleBefore)) return false;
    } else if (room.id !== reason.gameRoomId) {
      return false;
    }

    await prisma.$transaction(async (tx) => {
      const rounds = await tx.round.findMany({
        where: { gameRoomId: room.id },
        select: { id: true },
      });
      const roundIds = rounds.map((round) => round.id);

      await archivePracticeMatch(tx, room.id);
      await tx.playedCard.deleteMany({
        where: { hand: { roundId: { in: roundIds } } },
      });
      await tx.playerCard.deleteMany({
        where: { roundId: { in: roundIds } },
      });
      await tx.hand.deleteMany({ where: { roundId: { in: roundIds } } });
      await tx.round.deleteMany({ where: { gameRoomId: room.id } });
      await tx.player.deleteMany({ where: { gameRoomId: room.id } });
      await tx.gameRoom.delete({ where: { id: room.id } });
    });

    clearRuntimeRoom(room.code);
    return true;
  });
}

async function retirePreviousPracticeRooms(
  userId: number,
  newRoomCode: string,
): Promise<void> {
  const rooms = await prisma.gameRoom.findMany({
    where: {
      isPractice: true,
      code: { not: newRoomCode },
      players: { some: { userId } },
    },
    select: { code: true },
  });

  for (const room of rooms) {
    try {
      await retirePracticeRoom({
        roomCode: room.code,
        reason: { kind: "participant_leave", userId },
      });
    } catch (error) {
      if (!(error instanceof GameError && error.status === 404)) throw error;
    }
  }
}

export async function createPracticeRoomCommand(args: {
  userId: number;
  tier: BotTier;
}) {
  return withRoomLock(`practice-user:${args.userId}`, async () => {
    await assertNoActiveMultiplayerGame(args.userId);
    await ensureBotServiceReady(args.tier);

    const botUserIds = await ensureBotUsers();
    const code = await generateUniqueRoomCode();
    const room = await prisma.gameRoom.create({
      data: {
        code,
        isPractice: true,
        players: {
          create: [
            { userId: args.userId, seat: 0, team: 0, isReady: true },
            {
              userId: botUserIds[0],
              seat: 1,
              team: 1,
              isReady: true,
              botModel: args.tier,
            },
            {
              userId: botUserIds[1],
              seat: 2,
              team: 0,
              isReady: true,
              botModel: args.tier,
            },
            {
              userId: botUserIds[2],
              seat: 3,
              team: 1,
              isReady: true,
              botModel: args.tier,
            },
          ],
        },
      },
      select: { id: true, code: true },
    });

    try {
      registerBotSeats(
        code,
        botUserIds.map((userId) => ({ userId, tier: args.tier })),
      );
      await startFirstRound(room.id, room.code);
      await retirePreviousPracticeRooms(args.userId, room.code);
      return room;
    } catch (creationError) {
      try {
        await retirePracticeRoom({
          roomCode: room.code,
          reason: { kind: "failed_creation", gameRoomId: room.id },
        });
      } catch (cleanupError) {
        throw new PracticeRoomCleanupError(creationError, cleanupError);
      }
      throw creationError;
    }
  });
}

function assertPausablePracticeRoom(
  room: {
    isPractice: boolean;
    started: boolean;
    finished: boolean;
    players: { userId: number; botModel: string | null }[];
  },
  userId: number,
): void {
  const player = room.players.find((candidate) => candidate.userId === userId);
  if (!player || player.botModel !== null) {
    throw new GameError("You are not the human player in this room", 403);
  }
  if (!room.isPractice) {
    throw new GameError("Only practice games can be paused", 409);
  }
  if (!room.started || room.finished) {
    throw new GameError("Only active practice games can be paused", 409);
  }
}

export async function pausePracticeRoomCommand(
  args: {
    roomCode: string;
    userId: number;
  },
  onCommitted?: (room: { code: string; pausedAt: Date | null }) => void,
) {
  return withRoomLock(args.roomCode, async () => {
    const room = await prisma.gameRoom.findUnique({
      where: { code: args.roomCode },
      include: { players: true },
    });
    if (!room) throw new GameError("Room not found", 404);
    assertPausablePracticeRoom(room, args.userId);

    if (!room.pausedAt) {
      const update = await prisma.gameRoom.updateMany({
        where: {
          id: room.id,
          isPractice: true,
          started: true,
          finished: false,
          pausedAt: null,
        },
        data: {
          pausedAt: new Date(),
          pauseEpoch: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });
      if (update.count === 0) {
        const current = await prisma.gameRoom.findUnique({
          where: { id: room.id },
          select: { pausedAt: true },
        });
        if (!current?.pausedAt) {
          throw new GameError("Practice game state changed; retry", 409);
        }
      }
    }
    clearTurnTimer(args.roomCode);

    const pausedRoom = await prisma.gameRoom.findUniqueOrThrow({
      where: { id: room.id },
      select: { code: true, pausedAt: true },
    });
    onCommitted?.(pausedRoom);
    return pausedRoom;
  });
}

export async function resumePracticeRoomCommand(
  args: {
    roomCode: string;
    userId: number;
  },
  onCommitted?: (room: { code: string; resumed: boolean }) => void,
) {
  return withRoomLock(args.roomCode, async () => {
    const room = await prisma.gameRoom.findUnique({
      where: { code: args.roomCode },
      include: { players: true },
    });
    if (!room) throw new GameError("Room not found", 404);
    assertPausablePracticeRoom(room, args.userId);

    if (room.pausedAt) {
      clearTurnTimer(args.roomCode);
      const update = await prisma.gameRoom.updateMany({
        where: {
          id: room.id,
          isPractice: true,
          started: true,
          finished: false,
          pausedAt: { not: null },
        },
        data: {
          pausedAt: null,
          pauseEpoch: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });
      if (update.count === 0) {
        const current = await prisma.gameRoom.findUnique({
          where: { id: room.id },
          select: { pausedAt: true },
        });
        if (current?.pausedAt) {
          throw new GameError("Practice game state changed; retry", 409);
        }
      }
    }

    const resumedRoom = { code: room.code, resumed: room.pausedAt !== null };
    onCommitted?.(resumedRoom);
    return resumedRoom;
  });
}
