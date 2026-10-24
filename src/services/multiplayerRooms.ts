import { prisma } from "../db";
import { PUBLIC_PLAYER_SELECT } from "../domain/publicPlayer";
import { GameError } from "../utils/gameError";
import { withRoomLock } from "../utils/roomLock";
import { assertNoActiveMultiplayerGame } from "./roomQueries";
import { generateUniqueRoomCode } from "./roomCode";
import { startFirstRound } from "../game/transitions/round";
import { publishEvent } from "../runtime/eventPublisher";

export async function createMultiplayerRoom(userId: number) {
  await assertNoActiveMultiplayerGame(userId);

  const room = await prisma.gameRoom.create({
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
  publishEvent(
    "lobby",
    "room_created",
    {
      room: {
        id: room.id,
        code: room.code,
        currentPlayers: room.players.length,
        maxPlayers: 4,
      },
    },
    { roomCode: room.code },
  );
  return room;
}

export async function joinMultiplayerRoom(args: {
  roomCode: string;
  userId: number;
}) {
  await assertNoActiveMultiplayerGame(args.userId);

  const room = await withRoomLock(args.roomCode, async () => {
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
  if (room.players.length >= 4) {
    publishEvent("lobby", "room_full", { roomCode: args.roomCode });
  } else {
    publishEvent("lobby", "room_updated", {
      roomCode: args.roomCode,
      currentPlayers: room.players.length,
    });
  }
  return room;
}

export async function chooseMultiplayerTeam(args: {
  roomCode: string;
  userId: number;
  team: number;
}) {
  if (args.team !== 0 && args.team !== 1) {
    throw new GameError("Invalid team selection", 400);
  }

  const result = await withRoomLock(args.roomCode, async () => {
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
  if (result.changed) {
    publishEvent(
      args.roomCode,
      "team_chosen",
      {
        userId: args.userId,
        playerId: result.player.id,
        team: args.team,
      },
      { userId: args.userId },
    );
  }
  return { success: true, player: result.player };
}

export async function setMultiplayerReady(args: {
  roomCode: string;
  userId: number;
  isReady: boolean;
}) {
  if (typeof args.isReady !== "boolean") {
    throw new GameError("Ready status is required", 400);
  }

  const result = await withRoomLock(args.roomCode, async () => {
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
      publishEvent(args.roomCode, "ready_changed", {
        userId: args.userId,
        playerId: updatedPlayer.id,
        isReady: args.isReady,
      });
    }

    if (allReady && teamsComplete) {
      await startFirstRound(room.id, args.roomCode);
    }

    return { player: updatedPlayer, allReady };
  });
  return {
    success: true,
    player: result.player,
    allReady: result.allReady,
  };
}
