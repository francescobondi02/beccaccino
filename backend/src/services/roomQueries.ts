import { prisma } from "../db";
import { PUBLIC_PLAYER_SELECT } from "../domain/publicPlayer";
import { forbidden, notFound } from "../http/errors";
import { GameError } from "../utils/gameError";

export class ActiveGameConflictError extends GameError {
  constructor(readonly activeRoomCode: string) {
    super("Sei già in una partita attiva", 409, { activeRoomCode });
  }
}

export async function assertNoActiveMultiplayerGame(
  userId: number,
): Promise<void> {
  const activeGame = await prisma.player.findFirst({
    where: {
      userId,
      abandonedAt: null,
      gameRoom: { finished: false, isPractice: false },
    },
    orderBy: { gameRoom: { started: "desc" } },
    select: { gameRoom: { select: { code: true } } },
  });
  if (activeGame) {
    throw new ActiveGameConflictError(activeGame.gameRoom.code);
  }
}

export async function listRoomsForLobby(userId: number) {
  const candidateRooms = await prisma.gameRoom.findMany({
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
      finished: false,
      OR: [{ started: true }, { isPractice: false }],
      players: { some: { userId, abandonedAt: null } },
    },
    include: {
      players: { select: PUBLIC_PLAYER_SELECT },
    },
  });
  return {
    availableRooms: candidateRooms.filter(
      (room) => room.players.length < 4,
    ),
    activeGames,
  };
}

export async function getRoomForUser(roomCode: string, userId: number) {
  const room = await prisma.gameRoom.findUnique({
    where: { code: roomCode },
    include: { players: { select: PUBLIC_PLAYER_SELECT } },
  });
  if (!room) throw notFound("Room not found");
  const player = room.players.find((player) => player.userId === userId);
  if (!player) {
    throw forbidden("You are not a player in this room");
  }
  if (!room.finished && player.abandonedAt) {
    throw forbidden("Hai abbandonato questa partita");
  }
  return room;
}
