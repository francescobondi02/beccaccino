import { prisma } from "../db";
import { GameError } from "../utils/gameError";
import { withRoomLock } from "../utils/roomLock";
import { startFirstRound } from "./turnCoordinator";

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
