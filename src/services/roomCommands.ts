import { prisma } from "../db";
import { GameError } from "../utils/gameError";
import { withRoomLock } from "../utils/roomLock";
import { startFirstRound } from "./turnCoordinator";
import { generateRoomCode } from "../utils/generateRoomCode";
import { PUBLIC_PLAYER_SELECT } from "../domain/publicPlayer";
import { BotTier, ensureBotUsers } from "./botService";
import { ensureBotServiceReady } from "./botClient";
import { archivePracticeMatch } from "./practiceArchive";
import {
  registerBotSeats,
} from "../runtime/botRegistry";
import { clearTurnTimer } from "../runtime/turnTimer";
import { clearRuntimeRoom } from "../runtime/turnRuntime";

export class ActiveGameConflict extends GameError {
  constructor(readonly activeRoomCode: string) {
    super("Sei già in una partita attiva", 409, { activeRoomCode });
  }
}

class PracticeRoomCleanupError extends Error {
  constructor(
    readonly creationError: unknown,
    readonly cleanupError: unknown,
  ) {
    super("Practice room creation failed and cleanup was unsuccessful");
    this.name = "PracticeRoomCleanupError";
  }
}

export async function findActiveGame(userId: number) {
  return prisma.player.findFirst({
    where: {
      userId,
      gameRoom: { started: true, finished: false, isPractice: false },
    },
    select: {
      gameRoom: {
        select: { code: true },
      },
    },
  });
}

async function rejectActiveGame(userId: number): Promise<void> {
  const activeGame = await findActiveGame(userId);
  if (activeGame) {
    throw new ActiveGameConflict(activeGame.gameRoom.code);
  }
}

async function deletePreviousPracticeRooms(
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
      await leaveRoomCommand({ roomCode: room.code, userId });
    } catch (error) {
      if (!(error instanceof GameError && error.status === 404)) throw error;
    }
  }
}

async function generateUniqueRoomCode(): Promise<string> {
  let code: string;
  let exists: boolean;

  do {
    code = generateRoomCode();
    exists = Boolean(
      await prisma.gameRoom.findUnique({
        where: { code },
        select: { id: true },
      }),
    );
  } while (exists);

  return code;
}

export async function createRoomCommand(userId: number) {
  await rejectActiveGame(userId);

  return prisma.gameRoom.create({
    data: {
      code: await generateUniqueRoomCode(),
      players: {
        create: {
          userId,
          seat: 0,
        },
      },
    },
    include: {
      players: {
        select: PUBLIC_PLAYER_SELECT,
      },
    },
  });
}

export async function createPracticeRoomCommand(args: {
  userId: number;
  tier: BotTier;
}) {
  return withRoomLock(`practice-user:${args.userId}`, async () => {
    await rejectActiveGame(args.userId);
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
      await deletePreviousPracticeRooms(args.userId, room.code);
      return room;
    } catch (creationError) {
      try {
        await withRoomLock(code, async () => {
          await deleteRoomAndPlay(room.id);
          clearRuntimeRoom(code);
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

export async function joinRoomCommand(args: {
  roomCode: string;
  userId: number;
}) {
  await rejectActiveGame(args.userId);

  return withRoomLock(args.roomCode, async () => {
    const room = await prisma.gameRoom.findUnique({
      where: { code: args.roomCode },
      include: { players: true },
    });
    if (!room) throw new GameError("Room not found", 404);
    if (room.started) {
      throw new GameError("Room has already started", 400);
    }
    if (room.players.length >= 4) {
      throw new GameError("Room is full", 400);
    }
    if (room.players.some((player) => player.userId === args.userId)) {
      throw new GameError("User already in the room", 400);
    }

    await prisma.player.create({
      data: {
        userId: args.userId,
        gameRoomId: room.id,
      },
    });

    return prisma.gameRoom.findUniqueOrThrow({
      where: { code: args.roomCode },
      include: {
        players: {
          select: PUBLIC_PLAYER_SELECT,
        },
      },
    });
  });
}

export type LeaveRoomResult =
  | { kind: "practice_deleted" }
  | { kind: "finished_preserved" }
  | { kind: "room_deleted" }
  | { kind: "player_left" };

export async function leaveRoomCommand(args: {
  roomCode: string;
  userId: number;
}): Promise<LeaveRoomResult> {
  return withRoomLock(args.roomCode, async () => {
    const room = await prisma.gameRoom.findUnique({
      where: { code: args.roomCode },
      include: { players: true },
    });
    if (!room) throw new GameError("Room not found", 404);

    const player = room.players.find(
      (candidate) => candidate.userId === args.userId,
    );
    if (!player) {
      throw new GameError("Player not found in room", 404);
    }

    if (room.isPractice) {
      await deleteRoomAndPlay(room.id);
      clearRuntimeRoom(args.roomCode);
      return { kind: "practice_deleted" };
    }
    if (room.started && !room.finished) {
      throw new GameError("Cannot leave an active multiplayer game", 409);
    }
    if (room.finished) {
      return { kind: "finished_preserved" };
    }
    if (room.players.length === 1) {
      await prisma.$transaction([
        prisma.player.deleteMany({ where: { gameRoomId: room.id } }),
        prisma.gameRoom.delete({ where: { id: room.id } }),
      ]);
      return { kind: "room_deleted" };
    }

    await prisma.player.delete({ where: { id: player.id } });
    return { kind: "player_left" };
  });
}

export async function deleteRoomAndPlay(gameRoomId: number): Promise<void> {
  const rounds = await prisma.round.findMany({
    where: { gameRoomId },
    select: { id: true },
  });
  const roundIds = rounds.map((round) => round.id);

  await prisma.$transaction(async (tx) => {
    // Practice games are training data, and this is the only exit they have.
    // Snapshot before the deletes, in the same transaction: either both land or
    // the game stays and the next sweep retries it.
    await archivePracticeMatch(tx, gameRoomId);

    await tx.playedCard.deleteMany({
      where: { hand: { roundId: { in: roundIds } } },
    });
    await tx.playerCard.deleteMany({ where: { roundId: { in: roundIds } } });
    await tx.hand.deleteMany({ where: { roundId: { in: roundIds } } });
    await tx.round.deleteMany({ where: { gameRoomId } });
    await tx.player.deleteMany({ where: { gameRoomId } });
    await tx.gameRoom.deleteMany({ where: { id: gameRoomId } });
  });
}

export async function chooseTeamCommand(args: {
  roomCode: string;
  userId: number;
  team: number;
}) {
  if (args.team !== 0 && args.team !== 1) {
    throw new GameError("Invalid team selection", 400);
  }

  return withRoomLock(args.roomCode, async () => {
    const room = await prisma.gameRoom.findUnique({
      where: { code: args.roomCode },
      include: { players: true },
    });
    if (!room) throw new GameError("Room not found", 404);

    const player = room.players.find(
      (candidate) => candidate.userId === args.userId,
    );
    if (!player) {
      throw new GameError("User is not a player in this room", 403);
    }
    if (player.team === args.team) {
      return { player, changed: false };
    }
    if (room.started) {
      throw new GameError(
        "Cannot change team after the game has started",
        409,
      );
    }
    if (player.isReady) {
      throw new GameError(
        "Non puoi cambiare team dopo esserti messo pronto",
        400,
      );
    }

    const teamCount = room.players.filter(
      (candidate) => candidate.team === args.team,
    ).length;
    if (teamCount >= 2) {
      throw new GameError("Team is already full", 400);
    }

    const updatedPlayer = await prisma.player.update({
      where: { id: player.id },
      data: { team: args.team },
    });
    return { player: updatedPlayer, changed: true };
  });
}

export async function setReadyCommand(args: {
  roomCode: string;
  userId: number;
  isReady: boolean;
  onReadyChanged?: (event: {
    userId: number;
    playerId: number;
    isReady: boolean;
  }) => void | Promise<void>;
}) {
  if (typeof args.isReady !== "boolean") {
    throw new GameError("Ready status is required", 400);
  }

  return withRoomLock(args.roomCode, async () => {
    const room = await prisma.gameRoom.findUnique({
      where: { code: args.roomCode },
      include: { players: true },
    });
    if (!room) throw new GameError("Room not found", 404);

    const player = room.players.find(
      (candidate) => candidate.userId === args.userId,
    );
    if (!player) {
      throw new GameError("User is not a player in this room", 403);
    }
    if (room.started) {
      if (player.isReady === args.isReady) {
        return {
          player,
          allReady: room.players.every((candidate) => candidate.isReady),
          changed: false,
        };
      }
      throw new GameError(
        "Cannot change ready status after the game has started",
        409,
      );
    }
    if (player.team === null) {
      throw new GameError(
        "Player must choose a team before readying up",
        403,
      );
    }

    const changed = player.isReady !== args.isReady;
    const updatedPlayer = changed
      ? await prisma.player.update({
          where: { id: player.id },
          data: { isReady: args.isReady },
        })
      : player;
    const players = room.players.map((candidate) =>
      candidate.id === player.id ? updatedPlayer : candidate,
    );
    const allReady = players.every((candidate) => candidate.isReady);
    const teamsComplete =
      players.filter((candidate) => candidate.team === 0).length === 2 &&
      players.filter((candidate) => candidate.team === 1).length === 2;

    if (changed) {
      await args.onReadyChanged?.({
        userId: args.userId,
        playerId: updatedPlayer.id,
        isReady: args.isReady,
      });
    }

    if (allReady && teamsComplete) {
      await startFirstRound(room.id, args.roomCode);
    }

    return { player: updatedPlayer, allReady, changed };
  });
}
