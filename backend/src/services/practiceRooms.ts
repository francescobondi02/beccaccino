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

// Deletes an unstarted room; closes a started game with no winner.
export function retirePracticeRoom(roomCode: string, staleBefore?: Date): Promise<boolean> {
  return withRoomLock(roomCode, async () => {
    const room = await prisma.gameRoom.findUnique({ where: { code: roomCode } });
    if (!room || room.finished) return false;
    if (staleBefore && room.lastActivityAt > staleBefore) return false;

    if (!room.started) {
      await deleteRoom(room.id);
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
  });
}

// Removes every row of a room, including a partly created game.
export async function deleteRoom(gameRoomId: number): Promise<void> {
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
          create: [args.userId, ...botUserIds].map((userId, seat) => ({
            userId,
            seat,
            team: seat % 2,
            isReady: true,
            botModel: seat === 0 ? null : args.tier,
          })),
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
        logger.error({ err: cleanupError, roomCode: room.code }, "practice_room_cleanup_failed");
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

export async function setPracticePaused(args: { roomCode: string; userId: number }, paused: boolean) {
  const state = await runGameAction(args.roomCode, async (game, tx) => {
    const player = game.players.find((candidate) => candidate.userId === args.userId);
    if (!player || player.botModel !== null) {
      throw new GameError("You are not the human player in this room", 403);
    }
    if (!game.room.isPractice) {
      throw new GameError("Only practice games can be paused", 409);
    }
    if (!game.room.started || game.room.finished) {
      throw new GameError("Only active practice games can be paused", 409);
    }
    if ((game.room.pausedAt !== null) === paused) return null;
    await tx.gameRoom.update({
      where: { id: game.room.id },
      data: { pausedAt: paused ? new Date() : null },
    });
    return { kind: paused ? "paused" : "resumed" };
  }, args.userId);
  if (state !== null) publishRoomChanged(args.roomCode);
  logger.info(args, paused ? "practice_game_paused" : "practice_game_resumed");
  return { success: true, paused };
}
