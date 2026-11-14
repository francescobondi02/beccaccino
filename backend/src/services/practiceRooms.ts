import { prisma } from "../db";
import { clearTurnTimer } from "../runtime/turnTimer";
import { GameError } from "../utils/gameError";
import { withRoomLock } from "../utils/roomLock";
import { ensureBotServiceReady } from "./botClient";
import { BotTier, ensureBotUsers } from "./botUsers";
import { generateUniqueRoomCode } from "./roomCode";
import { assertNoActiveMultiplayerGame } from "./roomQueries";
import { startFirstRound } from "../game/transitions/round";
import { runGameAction, runGameActionUnlocked } from "../game/runGameAction";
import { logger } from "../logger";
import { publishRoomChanged } from "../runtime/eventPublisher";
import type { LiveGame } from "../game/liveGame";

class PracticeRoomCleanupError extends Error {
  constructor(
    readonly creationError: unknown,
    readonly cleanupError: unknown,
  ) {
    super("Practice room creation failed and cleanup was unsuccessful");
    this.name = "PracticeRoomCleanupError";
  }
}

// Deletes an unstarted room; closes a started game with no winner. Callers hold the room lock.
export async function retirePracticeRoomUnlocked(
  roomCode: string,
  staleBefore?: Date,
): Promise<boolean> {
  const room = await prisma.gameRoom.findUnique({ where: { code: roomCode } });
  if (!room || room.finished) return false;
  if (!room.isPractice) throw new GameError("Only practice rooms can be retired", 409);
  if (staleBefore && room.lastActivityAt > staleBefore) return false;

  if (!room.started) {
    await deleteRoom(room.id);
    clearTurnTimer(roomCode);
  } else {
    await runGameActionUnlocked(roomCode, async (game, tx) => {
      await tx.gameRoom.update({
        where: { id: game.room.id },
        data: { finished: true, winnerTeam: null },
      });
      const human = game.players.find((player) => !player.isBot)!;
      return { kind: "abandoned", userId: human.userId };
    });
  }
  publishRoomChanged(roomCode);
  return true;
}

export function retirePracticeRoom(roomCode: string, staleBefore?: Date): Promise<boolean> {
  return withRoomLock(roomCode, () => retirePracticeRoomUnlocked(roomCode, staleBefore));
}

// Removes every row of a room, including a partly created game.
async function deleteRoom(gameRoomId: number): Promise<void> {
  await prisma.$transaction([
    prisma.playedCard.deleteMany({ where: { trick: { round: { gameRoomId } } } }),
    prisma.handCard.deleteMany({ where: { round: { gameRoomId } } }),
    prisma.trick.deleteMany({ where: { round: { gameRoomId } } }),
    prisma.round.deleteMany({ where: { gameRoomId } }),
    prisma.player.deleteMany({ where: { gameRoomId } }),
    prisma.gameRoom.delete({ where: { id: gameRoomId } }),
  ]);
}

async function retirePreviousPracticeRooms(
  userId: number,
  newRoomCode: string,
): Promise<void> {
  const rooms = await prisma.gameRoom.findMany({
    where: {
      isPractice: true,
      finished: false,
      code: { not: newRoomCode },
      players: { some: { userId } },
    },
    select: { code: true },
  });
  for (const room of rooms) await retirePracticeRoom(room.code);
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
      await withRoomLock(room.code, () => startFirstRound(room.code));
      await retirePreviousPracticeRooms(args.userId, room.code);
      return room;
    } catch (creationError) {
      try {
        await withRoomLock(room.code, async () => {
          await deleteRoom(room.id);
          clearTurnTimer(room.code);
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

function assertPausable(game: LiveGame, userId: number): void {
  const player = game.players.find((candidate) => candidate.userId === userId);
  if (!player || player.botModel !== null) {
    throw new GameError("You are not the human player in this room", 403);
  }
  if (!game.room.isPractice) {
    throw new GameError("Only practice games can be paused", 409);
  }
  if (!game.room.started || game.room.finished) {
    throw new GameError("Only active practice games can be paused", 409);
  }
}

export async function pausePracticeRoom(args: { roomCode: string; userId: number }) {
  let pausedAt: Date | null = null;
  const state = await runGameAction(args.roomCode, async (game, tx) => {
    assertPausable(game, args.userId);
    pausedAt = game.room.pausedAt;
    if (pausedAt) return null;
    pausedAt = new Date();
    await tx.gameRoom.update({ where: { id: game.room.id }, data: { pausedAt } });
    return { kind: "paused" };
  }, args.userId);
  if (state !== null) publishRoomChanged(args.roomCode);
  logger.info(args, "practice_game_paused");
  return { success: true, paused: true, pausedAt };
}

export async function resumePracticeRoom(args: { roomCode: string; userId: number }) {
  const state = await runGameAction(args.roomCode, async (game, tx) => {
    assertPausable(game, args.userId);
    if (!game.room.pausedAt) return null;
    await tx.gameRoom.update({ where: { id: game.room.id }, data: { pausedAt: null } });
    return { kind: "resumed" };
  }, args.userId);
  if (state !== null) publishRoomChanged(args.roomCode);
  logger.info(args, "practice_game_resumed");
  return { success: true, paused: false };
}
