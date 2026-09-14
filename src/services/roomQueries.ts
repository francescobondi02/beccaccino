import { prisma } from "../db";
import { PUBLIC_PLAYER_SELECT } from "../domain/publicPlayer";
import { forbidden, notFound } from "../http/errors";
import { GameError } from "../utils/gameError";

export class ActiveGameConflict extends GameError {
  constructor(readonly activeRoomCode: string) {
    super("Sei già in una partita attiva", 409, { activeRoomCode });
  }
}

export async function findActiveMultiplayerGame(userId: number) {
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

export async function assertNoActiveMultiplayerGame(
  userId: number,
): Promise<void> {
  const activeGame = await findActiveMultiplayerGame(userId);
  if (activeGame) {
    throw new ActiveGameConflict(activeGame.gameRoom.code);
  }
}

export async function listRoomsForLobby(userId: number) {
  const availableRoomsRaw = await prisma.gameRoom.findMany({
    where: {
      started: false,
      finished: false,
      isPractice: false,
      players: { some: {} },
      NOT: { players: { some: { userId } } },
    },
    include: {
      players: { select: PUBLIC_PLAYER_SELECT },
    },
  });
  const activeGames = await prisma.gameRoom.findMany({
    where: {
      started: true,
      finished: false,
      players: { some: { userId } },
    },
    include: {
      players: { select: PUBLIC_PLAYER_SELECT },
    },
  });
  return {
    availableRooms: availableRoomsRaw.filter(
      (room) => room.players.length < 4,
    ),
    activeGames,
  };
}

export function findRoomByCode(roomCode: string) {
  return prisma.gameRoom.findUnique({
    where: { code: roomCode },
    include: {
      players: { select: PUBLIC_PLAYER_SELECT },
    },
  });
}

export async function getRoomForUser(roomCode: string, userId: number) {
  const room = await findRoomByCode(roomCode);
  if (!room) throw notFound("Room not found");
  if (!room.players.some((player) => player.userId === userId)) {
    throw forbidden("You are not a player in this room");
  }
  return room;
}
