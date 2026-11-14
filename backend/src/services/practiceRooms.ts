import { prisma } from "../db";
import { registerBotSeats, restoreBotSeats } from "../runtime/botRegistry";
import { clearRuntimeRoom, startRuntimeTurn } from "../runtime/turnRuntime";
import { clearTurnTimer, hasTurnRuntime } from "../runtime/turnTimer";
import { GameError } from "../utils/gameError";
import { withRoomLock } from "../utils/roomLock";
import { ensureBotServiceReady } from "./botClient";
import { BotTier, ensureBotUsers } from "./botUsers";
import { generateUniqueRoomCode } from "./roomCode";
import { assertNoActiveMultiplayerGame } from "./roomQueries";
import { startFirstRound } from "../game/transitions/round";
import { logger } from "../logger";
import { publishRoomChanged } from "../runtime/eventPublisher";
import { sendGameState } from "./gameState";
import {
  readCallerPlayerId,
  readCurrentTurn,
} from "../game/snapshots/turnState";

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
    publishRoomChanged(room.code);
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

export async function createPracticeRoom(args: {
  userId: number;
  tier: BotTier;
}) {
  const room = await withRoomLock(`practice-user:${args.userId}`, async () => {
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
  logger.info(
    { roomCode: room.code, userId: args.userId, tier: args.tier },
    "practice_game_started",
  );
  return { code: room.code, tier: args.tier };
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

export async function pausePracticeRoom(
  args: {
    roomCode: string;
    userId: number;
  },
) {
  const room = await withRoomLock(args.roomCode, async () => {
    const room = await prisma.gameRoom.findUnique({
      where: { code: args.roomCode },
      include: { players: true },
    });
    if (!room) throw new GameError("Room not found", 404);
    assertPausablePracticeRoom(room, args.userId);

    let paused = false;
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
          version: { increment: 1 },
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
      } else {
        paused = true;
      }
    }
    clearTurnTimer(args.roomCode);
    if (paused) await sendGameState(args.roomCode, { kind: "paused" });

    const pausedRoom = await prisma.gameRoom.findUniqueOrThrow({
      where: { id: room.id },
      select: { code: true, pausedAt: true },
    });
    return { ...pausedRoom, paused };
  });
  if (room.paused) publishRoomChanged(args.roomCode);
  logger.info(args, "practice_game_paused");
  return {
    success: true,
    paused: true,
    pausedAt: room.pausedAt,
  };
}

export async function resumePracticeRoom(
  args: {
    roomCode: string;
    userId: number;
  },
) {
  const resumed = await withRoomLock(args.roomCode, async () => {
    const room = await prisma.gameRoom.findUnique({
      where: { code: args.roomCode },
      include: {
        players: true,
        rounds: { orderBy: { number: "desc" }, take: 1 },
      },
    });
    if (!room) throw new GameError("Room not found", 404);
    assertPausablePracticeRoom(room, args.userId);

    const round = room.rounds[0];
    if (!round) {
      throw new GameError("Practice game runtime unavailable; retry", 503);
    }
    const callerPlayerId = await readCallerPlayerId(round, room.players);
    const turn = await readCurrentTurn(round, room.players, callerPlayerId);
    if (!turn) {
      throw new GameError("Practice game runtime unavailable; retry", 503);
    }

    let pauseEpoch = room.pauseEpoch;
    if (room.pausedAt) {
      const update = await prisma.gameRoom.updateMany({
        where: {
          id: room.id,
          isPractice: true,
          started: true,
          finished: false,
          pausedAt: { not: null },
          pauseEpoch,
        },
        data: {
          pausedAt: null,
          pauseEpoch: { increment: 1 },
          version: { increment: 1 },
          lastActivityAt: new Date(),
        },
      });
      if (update.count !== 1) {
        throw new GameError("Practice game state changed; retry", 409);
      }
      pauseEpoch++;
    }

    restoreBotSeats(args.roomCode, room.players);
    if (
      !hasTurnRuntime(
        args.roomCode,
        turn.userId,
        turn.phase,
        pauseEpoch,
        turn.identity,
      )
    ) {
      startRuntimeTurn(
        args.roomCode,
        turn.userId,
        turn.phase,
        pauseEpoch,
        turn.identity,
      );
    }
    if (room.pausedAt !== null) await sendGameState(args.roomCode, { kind: "resumed" });
    return room.pausedAt !== null;
  });
  if (resumed) publishRoomChanged(args.roomCode);
  logger.info(args, "practice_game_resumed");
  return { success: true, paused: false };
}
