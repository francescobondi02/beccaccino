import { prisma } from "../db";
import { PUBLIC_PLAYER_SELECT } from "../domain/publicPlayer";
import { GameError } from "../utils/gameError";
import { withRoomLock } from "../utils/roomLock";
import { assertNoActiveMultiplayerGame } from "./roomQueries";
import { generateUniqueRoomCode } from "./roomCode";
import { startFirstRound } from "../game/transitions/round";
import { publishRoomChanged } from "../runtime/eventPublisher";
import { ensureBotServiceReady } from "./botClient";
import { BotTier, ensureBotUsers, isBotTier } from "./botUsers";

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
  publishRoomChanged(room.code);
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
  publishRoomChanged(args.roomCode);
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
    publishRoomChanged(args.roomCode, { lobby: false });
  }
  return { success: true, player: result.player };
}

export async function configureMultiplayerBots(args: {
  roomCode: string;
  userId: number;
  tier: BotTier | null;
}) {
  return withRoomLock(args.roomCode, async () => {
    const room = await prisma.gameRoom.findUnique({
      where: { code: args.roomCode },
      include: { players: { select: PUBLIC_PLAYER_SELECT } },
    });
    if (!room) throw new GameError("Room not found", 404);
    if (!room.players.some((player) => player.userId === args.userId)) {
      throw new GameError("You are not a player in this room", 403);
    }
    if (room.started || room.isPractice) {
      throw new GameError("Cannot configure bots in this room", 409);
    }
    if (room.botTier === args.tier) return room;

    const updatedRoom = await prisma.$transaction(async (tx) => {
      await tx.player.updateMany({
        where: { gameRoomId: room.id },
        data: { isReady: false },
      });
      return tx.gameRoom.update({
        where: { id: room.id },
        data: { botTier: args.tier },
        include: { players: { select: PUBLIC_PLAYER_SELECT } },
      });
    });
    publishRoomChanged(args.roomCode, { lobby: false });
    return updatedRoom;
  });
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
    const updatedPlayer = { ...player, isReady: args.isReady };
    const players = room.players.map((candidate) =>
      candidate.id === player.id ? updatedPlayer : candidate,
    );
    const allReady = players.every((candidate) => candidate.isReady);
    const teamsComplete =
      players.filter((candidate) => candidate.team === 0).length === 2 &&
      players.filter((candidate) => candidate.team === 1).length === 2;

    const fillWithBots =
      isBotTier(room.botTier) &&
      players.every((candidate) => candidate.team !== null);
    if (allReady && (teamsComplete || fillWithBots)) {
      const bots: { userId: number; team: number; botModel: BotTier }[] = [];
      if (isBotTier(room.botTier) && players.length < 4) {
        await ensureBotServiceReady(room.botTier);
        const botUserIds = await ensureBotUsers();
        for (const team of [0, 1]) {
          const teamCount = players.filter((candidate) => candidate.team === team).length;
          for (let count = teamCount; count < 2; count++) {
            bots.push({
              userId: botUserIds[bots.length],
              team,
              botModel: room.botTier,
            });
          }
        }
      }
      await startFirstRound(args.roomCode, {
        readyPlayerId: player.id,
        bots,
      });
      return { player: updatedPlayer, allReady };
    }

    if (changed) {
      await prisma.player.update({
        where: { id: player.id },
        data: { isReady: args.isReady },
      });
      publishRoomChanged(args.roomCode, { lobby: false });
    }

    return { player: updatedPlayer, allReady };
  });
  return {
    success: true,
    player: result.player,
    allReady: result.allReady,
  };
}
