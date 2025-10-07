// src/controllers/roomController.ts

import { Request, Response } from "express";
import { prisma } from "../db";
import { generateRoomCode } from "../utils/generateRoomCode";
import { setupRound } from "../services/gameService";

export const createRoom = async (req: Request, res: Response) => {
  const { userId } = req.body;
  if (!userId) {
    return res
      .status(400)
      .json({ error: "User ID is required to create a room" });
  }

  try {
    const code = await generateUniqueRoomCode();
    const room = await prisma.gameRoom.create({
      data: {
        code,
        players: {
          create: {
            userId,
            seat: 0,
          },
        },
      },
      include: {
        players: true,
      },
    });
    return res.status(201).json(room);
  } catch (error) {
    console.error("Error creating room:", error);
    return res.status(500).json({ error: "Room creation failed" });
  }
};

const generateUniqueRoomCode = async () => {
  let code: string;
  let exists = true;

  do {
    code = generateRoomCode();
    const room = await prisma.gameRoom.findUnique({ where: { code } });
    exists = !!room;
  } while (exists);

  return code;
};

export const getAvailableRooms = async (req: Request, res: Response) => {
  const userId = Number(req.query.userId);

  if (!userId) return res.status(400).json({ error: "User ID is required" });

  try {
    const rooms = await prisma.gameRoom.findMany({
      where: {
        started: false,
        finished: false,
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
        players: true,
      },
    });

    // Filter out rooms that are full (4 players)
    const availableRooms = rooms.filter((room) => room.players.length < 4);

    return res.status(200).json(availableRooms);
  } catch (error) {
    console.error("Error fetching available rooms:", error);
    return res.status(500).json({ error: "Failed to fetch available rooms" });
  }
};

export const joinRoom = async (req: Request, res: Response) => {
  const { roomCode, userId } = req.body;
  if (!roomCode || !userId) {
    return res
      .status(400)
      .json({ error: "Room code and User ID are required to join a room" });
  }

  try {
    // Prima, prendi la stanza con il codice
    const room = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: { players: true },
    });

    // Controlla che esista
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    // Controlla che non sia iniziata
    if (room.started) {
      return res.status(400).json({ error: "Room has already started" });
    }

    // Controlla che non sia piena
    if (room.players.length >= 4) {
      return res.status(400).json({ error: "Room is full" });
    }

    // Verifichiamo che non sia già dentro
    const alreadyInRoom = room.players.some(
      (player) => player.userId === userId
    );
    if (alreadyInRoom) {
      return res.status(400).json({ error: "User already in the room" });
    }

    // Crea il nuovo Player
    await prisma.player.create({
      data: {
        userId,
        gameRoomId: room.id,
        seat: null,
        team: null,
      },
    });

    // Ritorna la room aggiornata
    const updatedRoom = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: {
        players: {
          include: { user: true },
        },
      },
    });

    return res.json(updatedRoom);
  } catch (error) {
    console.error("Error joining room:", error);
    return res.status(500).json({ error: "Failed to join room" });
  }
};

export const setPlayerReady = async (req: Request, res: Response) => {
  const { roomCode } = req.params;
  const { userId, isReady } = req.body;

  if (typeof isReady !== "boolean" || !userId) {
    return res
      .status(400)
      .json({ error: "User ID and ready status are required" });
  }

  try {
    // Trova la stanza
    const room = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: { players: true },
    });

    if (!room) return res.status(404).json({ error: "Room not found" });

    // Trova il player nella stanza
    const player = room.players.find((p) => p.userId === userId);
    if (!player) {
      return res
        .status(403)
        .json({ error: "User is not a player in this room" });
    }

    // Aggiorna lo stato di ready del player
    const updatedPlayer = await prisma.player.update({
      where: { id: player.id },
      data: { isReady },
    });

    // Controlla se tutti i player sono pronti
    const allReady = room.players.every((p) =>
      p.id === updatedPlayer.id ? isReady : p.isReady
    );

    // Controlla che i teaam siano stati scelti e che siano completi (2 player per team)
    const team0Count = room.players.filter((p) =>
      p.id === updatedPlayer.id ? updatedPlayer.team === 0 : p.team === 0
    ).length;
    const team1Count = room.players.filter((p) =>
      p.id === updatedPlayer.id ? updatedPlayer.team === 1 : p.team === 1
    ).length;

    // Se tutti sono pronti e i team sono pieni e scelti, imposta la stanza come iniziata
    if (allReady && team0Count === 2 && team1Count === 2) {
      await prisma.gameRoom.update({
        where: { id: room.id },
        data: { started: true },
      });
      try {
        // setupRound
        await setupRound(room.id, 1);
      } catch (error) {
        console.error("Error setting up the first round:", error);
      }
    }

    return res
      .status(200)
      .json({ success: true, player: updatedPlayer, allReady });
  } catch (error) {
    console.error("Error setting player ready:", error);
    return res.status(500).json({ error: "Failed to set player ready" });
  }
};
