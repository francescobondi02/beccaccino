// src/controllers/roomController.ts

import { Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { prisma } from "../db";
import { getSocketInstance } from "../socketInstance";
import { logger } from "../logger";
import { BOT_TIERS, isBotTier } from "../services/botService";
import { PUBLIC_PLAYER_SELECT } from "../domain/publicPlayer";
import {
  ActiveGameConflict,
  createPracticeRoomCommand,
  createRoomCommand,
  joinRoomCommand,
  leaveRoomCommand,
  setReadyCommand,
} from "../services/roomCommands";
import { GameError } from "../utils/gameError";

export const createRoom = async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  try {
    const room = await createRoomCommand(userId);

    try {
      const io = getSocketInstance();
      io.to("lobby").emit("room_created", {
        room: {
          id: room.id,
          code: room.code,
          currentPlayers: room.players.length,
          maxPlayers: 4,
        },
      });
    } catch (socketError) {
      Sentry.captureException(socketError, {
        extra: { event: "room_created_broadcast", roomCode: room.code },
      });
      (req.log ?? logger).warn(
        { err: socketError, roomCode: room.code },
        "room_created_broadcast_failed",
      );
    }

    return res.status(201).json(room);
  } catch (error) {
    if (error instanceof ActiveGameConflict) {
      return res.status(error.status).json({
        error: error.message,
        activeRoomCode: error.activeRoomCode,
      });
    }
    Sentry.captureException(error, { extra: { userId, op: "create_room" } });
    (req.log ?? logger).error(
      { err: error, userId },
      "create_room_failed",
    );
    return res.status(500).json({ error: "Room creation failed" });
  }
};

/**
 * Create a practice game: the human plus three bots of one tier, already seated
 * and started.
 *
 * Unlike a normal room there is nothing to wait for — no lobby, no team picking,
 * no ready-up — so this creates the room fully formed and starts round 1 in one
 * request. The human sits at seat 0 with the bot partner opposite (seat 2) and
 * the two opponents at seats 1 and 3.
 */
export const createPracticeRoom = async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { tier } = req.body;

  if (!isBotTier(tier)) {
    return res.status(400).json({
      error: `Invalid tier: "${tier}". Must be one of: ${BOT_TIERS.join(", ")}`,
    });
  }

  try {
    const room = await createPracticeRoomCommand({ userId, tier });
    logger.info(
      { roomCode: room.code, userId, tier },
      "practice_game_started",
    );
    return res.status(201).json({ code: room.code, tier });
  } catch (error) {
    if (error instanceof ActiveGameConflict) {
      return res.status(error.status).json({
        error: error.message,
        activeRoomCode: error.activeRoomCode,
      });
    }
    Sentry.captureException(error, { extra: { userId, tier, op: "create_practice_room" } });
    (req.log ?? logger).error(
      { err: error, userId, tier },
      "create_practice_room_failed",
    );
    return res.status(500).json({ error: "Practice game creation failed" });
  }
};

export const getAvailableRooms = async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  try {
    // 1. Stanze disponibili: non iniziate, non piene, utente non dentro.
    // Le stanze di pratica sono escluse: i posti sono già occupati dai bot.
    const availableRoomsRaw = await prisma.gameRoom.findMany({
      where: {
        started: false,
        finished: false,
        isPractice: false,
        players: {
          some: {},
        },
        NOT: {
          players: {
            some: {
              userId,
            },
          },
        },
      },
      include: {
        players: {
          select: PUBLIC_PLAYER_SELECT,
        },
      },
    });

    // Filtra le stanze che non sono piene (meno di 4 giocatori)
    const availableRooms = availableRoomsRaw.filter(
      (room) => room.players.length < 4,
    );

    // 2. Giochi attivi: partite iniziate in cui l'utente è un giocatore
    const activeGames = await prisma.gameRoom.findMany({
      where: {
        started: true,
        finished: false,
        players: {
          some: {
            userId,
          },
        },
      },
      include: {
        players: {
          select: PUBLIC_PLAYER_SELECT,
        },
      },
    });

    return res.status(200).json({ availableRooms, activeGames });
  } catch (error) {
    Sentry.captureException(error, { extra: { op: "list_rooms" } });
    (req.log ?? logger).error({ err: error }, "list_rooms_failed");
    return res.status(500).json({ error: "Failed to fetch rooms" });
  }
};

export const getRoomByCode = async (req: Request, res: Response) => {
  const { roomCode } = req.params;
  const userId = req.user!.userId;

  try {
    const room = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: {
        players: {
          select: PUBLIC_PLAYER_SELECT,
        },
      },
    });

    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    //^ Verifica che l'utente sia un giocatore nella stanza
    const isPlayerInRoom = room.players.some((p) => p.userId === userId);
    if (!isPlayerInRoom) {
      return res
        .status(403)
        .json({ error: "You are not a player in this room" });
    }

    return res.status(200).json(room);
  } catch (error) {
    Sentry.captureException(error, {
      extra: { op: "get_room_by_code", roomCode, userId },
    });
    (req.log ?? logger).error(
      { err: error, roomCode, userId },
      "get_room_by_code_failed",
    );
    return res.status(500).json({ error: "Failed to fetch room" });
  }
};

export const joinRoom = async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { roomCode } = req.body;
  if (!roomCode) {
    return res.status(400).json({ error: "Room code is required to join a room" });
  }

  try {
    const room = await joinRoomCommand({ roomCode, userId });

    try {
      const io = getSocketInstance();
      if (room.players.length >= 4) {
        io.to("lobby").emit("room_full", { roomCode });
      } else {
        io.to("lobby").emit("room_updated", {
          roomCode,
          currentPlayers: room.players.length,
        });
      }
    } catch (socketError) {
      Sentry.captureException(socketError, {
        extra: { event: "join_room_broadcast", roomCode },
      });
      (req.log ?? logger).warn(
        { err: socketError, roomCode },
        "join_room_broadcast_failed",
      );
    }

    return res.status(200).json(room);
  } catch (error) {
    if (error instanceof ActiveGameConflict) {
      return res.status(error.status).json({
        error: error.message,
        activeRoomCode: error.activeRoomCode,
      });
    }
    if (error instanceof GameError) {
      return res.status(error.status).json({ error: error.message });
    }
    Sentry.captureException(error, {
      extra: { op: "join_room", roomCode, userId },
    });
    (req.log ?? logger).error(
      { err: error, roomCode, userId },
      "join_room_failed",
    );
    return res.status(500).json({ error: "Failed to join room" });
  }
};

export const setPlayerReady = async (req: Request, res: Response) => {
  /**
   * Permette a un giocatore di impostare il proprio stato di "ready" in una stanza di gioco.
   * Quando tutti i giocatori sono pronti e le squadre sono complete, la partita inizia automaticamente.
   * Se la partita inizia, viene creato il primo round.
   *
   * @param roomCode Codice della stanza di gioco (dal parametro URL)
   * @param userId ID dell'utente che imposta lo stato di ready (dal body della richiesta)
   * @param isReady Stato di ready (true o false) (dal body della richiesta)
   * @return Lo stato aggiornato del giocatore e se tutti sono pronti
   *
   * @note Controlla che l'utente sia un giocatore nella stanza
   * @note Controlla che il giocatore abbia scelto una squadra prima di potersi mettere ready
   * @note Se tutti i giocatori sono pronti e le squadre sono complete, imposta la stanza come iniziata e crea il primo round
   */

  const { roomCode } = req.params;
  const userId = req.user!.userId;
  const { isReady } = req.body;

  if (typeof isReady !== "boolean") {
    return res.status(400).json({ error: "Ready status is required" });
  }

  try {
    const result = await setReadyCommand({
      roomCode,
      userId,
      isReady,
      onReadyChanged: (event) => {
        getSocketInstance().to(roomCode).emit("ready_changed", event);
      },
    });

    return res.status(200).json({
      success: true,
      player: result.player,
      allReady: result.allReady,
    });
  } catch (error) {
    if (error instanceof GameError) {
      return res.status(error.status).json({ error: error.message });
    }
    Sentry.captureException(error, {
      extra: { op: "set_player_ready", roomCode, userId },
    });
    (req.log ?? logger).error(
      { err: error, roomCode, userId },
      "set_player_ready_failed",
    );
    return res.status(500).json({ error: "Failed to set player ready" });
  }
};

export const leaveRoom = async (req: Request, res: Response) => {
  const { roomCode } = req.params;
  const userId = req.user!.userId;

  try {
    const result = await leaveRoomCommand({ roomCode, userId });
    const io = getSocketInstance();

    switch (result.kind) {
      case "practice_deleted":
        io.to(roomCode).emit("practice_abandoned", { roomCode });
        logger.info({ roomCode, userId }, "practice_game_abandoned");
        return res.status(200).json({ success: true, deletedRoom: true });
      case "finished_preserved":
        return res.status(200).json({
          success: true,
          deletedRoom: false,
          preservedHistory: true,
        });
      case "room_deleted":
        io.to("lobby").emit("room_deleted", { roomCode });
        return res.status(200).json({ success: true, deletedRoom: true });
      case "player_left":
        io.to(roomCode).emit("player_left", { userId });
        return res.status(200).json({ success: true, deletedRoom: false });
    }
  } catch (error) {
    if (error instanceof GameError) {
      return res.status(error.status).json({ error: error.message });
    }
    Sentry.captureException(error, {
      extra: { op: "leave_room", roomCode, userId },
    });
    (req.log ?? logger).error(
      { err: error, roomCode, userId },
      "leave_room_failed",
    );
    return res.status(500).json({ error: "Failed to leave room" });
  }
};

export const getExitedRooms = async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  try {
    const rooms = await prisma.gameRoom.findMany({
      where: {
        players: {
          some: { userId },
        },
        finished: false,
      },
      include: {
        players: true,
      },
    });

    const formatted = rooms.map((room) => ({
      id: room.id,
      code: room.code,
      currentPlayers: room.players.length,
      maxPlayers: 4,
    }));

    return res.status(200).json(formatted);
  } catch (error) {
    Sentry.captureException(error, {
      extra: { op: "get_exited_rooms", userId },
    });
    (req.log ?? logger).error({ err: error, userId }, "get_exited_rooms_failed");
    return res.status(500).json({ error: "Failed to fetch rooms" });
  }
};
