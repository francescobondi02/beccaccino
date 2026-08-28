import { Request, Response } from "express";
import { prisma } from "../db";
import { forbidden, notFound } from "../http/errors";
import {
  parseJoinRoom,
  parsePracticeTier,
  parseReady,
  parseRoomCode,
} from "../http/input/rooms";
import { requireUser } from "../http/request";
import { logger } from "../logger";
import { publishEvent, runBestEffort } from "../runtime/eventPublisher";
import { recoverRoomRuntime } from "../runtime/recovery";
import { PUBLIC_PLAYER_SELECT } from "../domain/publicPlayer";
import {
  createPracticeRoomCommand,
  createRoomCommand,
  joinRoomCommand,
  leaveRoomCommand,
  pausePracticeRoomCommand,
  resumePracticeRoomCommand,
  setReadyCommand,
} from "../services/roomCommands";

export const createRoom = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
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
  return res.status(201).json(room);
};

export const createPracticeRoom = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const tier = parsePracticeTier(req.body);
  const room = await createPracticeRoomCommand({ userId, tier });

  logger.info({ roomCode: room.code, userId, tier }, "practice_game_started");
  return res.status(201).json({ code: room.code, tier });
};

export const getAvailableRooms = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
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
  const availableRooms = availableRoomsRaw.filter(
    (room) => room.players.length < 4,
  );
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

  return res.status(200).json({ availableRooms, activeGames });
};

export const getRoomByCode = async (req: Request, res: Response) => {
  const roomCode = parseRoomCode(req.params.roomCode);
  const { userId } = requireUser(req);
  const room = await prisma.gameRoom.findUnique({
    where: { code: roomCode },
    include: {
      players: { select: PUBLIC_PLAYER_SELECT },
    },
  });

  if (!room) throw notFound("Room not found");
  if (!room.players.some((player) => player.userId === userId)) {
    throw forbidden("You are not a player in this room");
  }
  return res.status(200).json(room);
};

export const joinRoom = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const roomCode = parseJoinRoom(req.body);
  const room = await joinRoomCommand({ roomCode, userId });

  if (room.players.length >= 4) {
    publishEvent("lobby", "room_full", { roomCode });
  } else {
    publishEvent("lobby", "room_updated", {
      roomCode,
      currentPlayers: room.players.length,
    });
  }
  return res.status(200).json(room);
};

export const setPlayerReady = async (req: Request, res: Response) => {
  const roomCode = parseRoomCode(req.params.roomCode);
  const { userId } = requireUser(req);
  const isReady = parseReady(req.body);
  const result = await setReadyCommand({
    roomCode,
    userId,
    isReady,
    onReadyChanged: (event) => {
      publishEvent(roomCode, "ready_changed", event);
    },
  });

  return res.status(200).json({
    success: true,
    player: result.player,
    allReady: result.allReady,
  });
};

export const leaveRoom = async (req: Request, res: Response) => {
  const roomCode = parseRoomCode(req.params.roomCode);
  const { userId } = requireUser(req);
  const result = await leaveRoomCommand({ roomCode, userId });

  switch (result.kind) {
    case "practice_deleted":
      publishEvent(roomCode, "practice_abandoned", { roomCode });
      publishEvent("lobby", "practice_abandoned", { roomCode });
      logger.info({ roomCode, userId }, "practice_game_abandoned");
      return res.status(200).json({ success: true, deletedRoom: true });
    case "finished_preserved":
      return res.status(200).json({
        success: true,
        deletedRoom: false,
        preservedHistory: true,
      });
    case "room_deleted":
      publishEvent("lobby", "room_deleted", { roomCode });
      return res.status(200).json({ success: true, deletedRoom: true });
    case "player_left":
      publishEvent(roomCode, "player_left", { userId });
      return res.status(200).json({ success: true, deletedRoom: false });
  }
};

export const pausePracticeRoom = async (req: Request, res: Response) => {
  const roomCode = parseRoomCode(req.params.roomCode);
  const { userId } = requireUser(req);
  const room = await pausePracticeRoomCommand(
    { roomCode, userId },
    (pausedRoom) => {
      const payload = { roomCode, pausedAt: pausedRoom.pausedAt };
      publishEvent(roomCode, "practice_paused", payload);
      publishEvent("lobby", "practice_paused", payload);
    },
  );

  logger.info({ roomCode, userId }, "practice_game_paused");
  return res.status(200).json({
    success: true,
    paused: true,
    pausedAt: room.pausedAt,
  });
};

export const resumePracticeRoom = async (req: Request, res: Response) => {
  const roomCode = parseRoomCode(req.params.roomCode);
  const { userId } = requireUser(req);
  await resumePracticeRoomCommand({ roomCode, userId }, () => {
    const payload = { roomCode };
    publishEvent(roomCode, "practice_resumed", payload);
    publishEvent("lobby", "practice_resumed", payload);
  });
  await runBestEffort(
    async () => {
      await recoverRoomRuntime(roomCode);
    },
    "resume_practice_runtime",
    { roomCode, userId },
  );

  logger.info({ roomCode, userId }, "practice_game_resumed");
  return res.status(200).json({ success: true, paused: false });
};

export const getExitedRooms = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const rooms = await prisma.gameRoom.findMany({
    where: {
      players: { some: { userId } },
      finished: false,
    },
    include: { players: true },
  });
  const formatted = rooms.map((room) => ({
    id: room.id,
    code: room.code,
    currentPlayers: room.players.length,
    maxPlayers: 4,
  }));

  return res.status(200).json(formatted);
};
