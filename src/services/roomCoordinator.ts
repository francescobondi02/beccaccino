import { BotTier } from "./botService";
import { logger } from "../logger";
import { publishEvent } from "../runtime/eventPublisher";
import { ensureRoomRuntime } from "../runtime/recovery";
import { GameError } from "../utils/gameError";
import {
  chooseTeamCommand,
  createRoomCommand,
  joinRoomCommand,
  setReadyCommand,
} from "./multiplayerRoomCommands";
import {
  createPracticeRoomCommand,
  pausePracticeRoomCommand,
  resumePracticeRoomCommand,
} from "./practiceRoomCommands";
import { leaveRoomCommand } from "./roomLifecycle";

export async function createMultiplayerRoom(userId: number) {
  const room = await createRoomCommand(userId);
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

export async function createPracticeRoom(args: {
  userId: number;
  tier: BotTier;
}) {
  const room = await createPracticeRoomCommand(args);
  logger.info(
    { roomCode: room.code, userId: args.userId, tier: args.tier },
    "practice_game_started",
  );
  return { code: room.code, tier: args.tier };
}

export async function joinMultiplayerRoom(args: {
  roomCode: string;
  userId: number;
}) {
  const room = await joinRoomCommand(args);
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
  const result = await chooseTeamCommand(args);
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
  const result = await setReadyCommand({
    ...args,
    onReadyChanged: (event) => {
      publishEvent(args.roomCode, "ready_changed", event);
    },
  });
  return {
    success: true,
    player: result.player,
    allReady: result.allReady,
  };
}

export async function leaveOwnedRoom(args: {
  roomCode: string;
  userId: number;
}) {
  const result = await leaveRoomCommand(args);
  switch (result.kind) {
    case "practice_deleted":
      publishEvent(args.roomCode, "practice_abandoned", {
        roomCode: args.roomCode,
      });
      publishEvent("lobby", "practice_abandoned", {
        roomCode: args.roomCode,
      });
      logger.info(args, "practice_game_abandoned");
      return { success: true, deletedRoom: true };
    case "finished_preserved":
      return {
        success: true,
        deletedRoom: false,
        preservedHistory: true,
      };
    case "room_deleted":
      publishEvent("lobby", "room_deleted", { roomCode: args.roomCode });
      return { success: true, deletedRoom: true };
    case "player_left":
      publishEvent(args.roomCode, "player_left", { userId: args.userId });
      return { success: true, deletedRoom: false };
  }
}

export async function pausePracticeRoom(args: {
  roomCode: string;
  userId: number;
}) {
  const room = await pausePracticeRoomCommand(args);
  if (room.paused) {
    const payload = {
      roomCode: args.roomCode,
      pausedAt: room.pausedAt,
    };
    publishEvent(args.roomCode, "practice_paused", payload);
    publishEvent("lobby", "practice_paused", payload);
  }

  logger.info(args, "practice_game_paused");
  return {
    success: true,
    paused: true,
    pausedAt: room.pausedAt,
  };
}

export async function resumePracticeRoom(args: {
  roomCode: string;
  userId: number;
}) {
  const room = await resumePracticeRoomCommand(args);
  if (!(await ensureRoomRuntime(args.roomCode))) {
    throw new GameError("Practice game runtime unavailable; retry", 503);
  }

  if (room.resumed) {
    const payload = { roomCode: args.roomCode };
    publishEvent(args.roomCode, "practice_resumed", payload);
    publishEvent("lobby", "practice_resumed", payload);
  }

  logger.info(args, "practice_game_resumed");
  return { success: true, paused: false };
}
