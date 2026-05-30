// src/controllers/roomController.ts

import { Request, Response } from "express";
import { prisma } from "../db";
import { generateRoomCode } from "../utils/generateRoomCode";
import { setupRound } from "../services/gameService";
import { getSocketInstance } from "../socketInstance";
import { startTurnTimer } from "../services/turnTimer";

export const createRoom = async (req: Request, res: Response) => {
  const userId = req.user!.userId;

  try {
    // Check if user is already in an active game
    const existingActiveGame = await prisma.player.findFirst({
      where: {
        userId,
        gameRoom: { started: true, finished: false },
      },
      include: { gameRoom: true },
    });

    if (existingActiveGame) {
      return res.status(409).json({
        error: "Sei già in una partita attiva",
        activeRoomCode: existingActiveGame.gameRoom.code,
      });
    }

    //^ Genera un codice univoco per la stanza e crea la stanza
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
        players: {
          include: {
            user: true,
          },
        },
      },
    });

    // 🔥 Notifica tutti gli utenti nella lobby globale della nuova stanza
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
      // Socket non critico, logghiamo ma non blocchiamo la risposta
      console.error("Socket notification failed:", socketError);
    }

    return res.status(201).json(room);
  } catch (error) {
    console.error("Error creating room:", error);
    return res.status(500).json({ error: "Room creation failed" });
  }
};

const generateUniqueRoomCode = async () => {
  /**
   * Genera un codice univoco per una stanza di gioco.
   * Continua a generare codici finché non ne trova uno che non esiste già nel database.
   *
   * @return Un codice univoco per la stanza di gioco
   */
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
  const userId = req.user!.userId;

  try {
    // 1. Stanze disponibili: non iniziate, non piene, utente non dentro
    const availableRoomsRaw = await prisma.gameRoom.findMany({
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
        players: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
              },
            },
          },
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
          include: {
            user: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
      },
    });

    return res.status(200).json({ availableRooms, activeGames });
  } catch (error) {
    console.error("Error fetching rooms:", error);
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
          include: {
            user: true,
          },
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
    console.error("Error fetching room by code:", error);
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
    // Check if user is already in an active game
    const existingActiveGame = await prisma.player.findFirst({
      where: {
        userId,
        gameRoom: { started: true, finished: false },
      },
      include: { gameRoom: true },
    });

    if (existingActiveGame) {
      return res.status(409).json({
        error: "Sei già in una partita attiva",
        activeRoomCode: existingActiveGame.gameRoom.code,
      });
    }

    //^ Troviamo la stanza a cui l'utente vuole unirsi
    const room = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: { players: true },
    });

    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    if (room.started) {
      return res.status(400).json({ error: "Room has already started" });
    }

    if (room.players.length >= 4) {
      return res.status(400).json({ error: "Room is full" });
    }

    //^ Verifichiamo che l'utente non sia già un giocatore dentro quella stanza
    const alreadyInRoom = room.players.some(
      (player) => player.userId === userId,
    );
    if (alreadyInRoom) {
      return res.status(400).json({ error: "User already in the room" });
    }

    //^ Creiamo un nuovo Player (ponte fra User e GameRoom)
    await prisma.player.create({
      data: {
        userId,
        gameRoomId: room.id,
        seat: null,
        team: null,
      },
    });

    //^ Prendiamo la stanza aggiornata con il nuovo giocatore e la restituiamo
    const updatedRoom = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: {
        players: {
          include: { user: true },
        },
      },
    });

    // 🔥 Notifica la lobby se la stanza è diventata piena o è stata aggiornata
    try {
      const io = getSocketInstance();
      const currentPlayers = updatedRoom?.players.length || 0;

      if (currentPlayers >= 4) {
        // Stanza piena - rimuovila dalla lista disponibili
        io.to("lobby").emit("room_full", {
          roomCode: roomCode,
        });
      } else {
        // Aggiorna il conteggio giocatori
        io.to("lobby").emit("room_updated", {
          roomCode: roomCode,
          currentPlayers: currentPlayers,
        });
      }
    } catch (socketError) {
      console.error("Socket notification failed:", socketError);
    }

    return res.json(updatedRoom);
  } catch (error) {
    console.error("Error joining room:", error);
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
    //^ Cerca la stanza attuale
    const room = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: { players: true },
    });

    if (!room) return res.status(404).json({ error: "Room not found" });

    //^ Trova il player nella stanza
    const player = room.players.find((p) => p.userId === userId);
    if (!player) {
      return res
        .status(403)
        .json({ error: "User is not a player in this room" });
    }

    //^ Controlla che abbia scelto un team (non può mettersi Ready se non ha un team)
    if (player.team === null) {
      return res
        .status(403)
        .json({ error: "Player must choose a team before readying up" });
    }

    //^ Aggiorna lo stato di Ready del player
    const updatedPlayer = await prisma.player.update({
      where: { id: player.id },
      data: { isReady },
    });

    //^ Prendiamo la stanza aggiornata con il nuovo stato di Ready del player
    const updatedRoom = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: { players: true },
    });

    if (!updatedRoom) {
      return res.status(404).json({ error: "Room not found after update" });
    }

    const allReady = updatedRoom.players.every((p) => p.isReady === true);

    const team0Count = updatedRoom.players.filter((p) => p.team === 0).length;
    const team1Count = updatedRoom.players.filter((p) => p.team === 1).length;

    //^ Notifica tutti nella room del cambiamento di stato Ready
    const io = getSocketInstance();
    io.to(roomCode).emit("ready_changed", {
      userId,
      isReady,
    });

    //^ Se tutti i Player sono pronti e i team sono pieni e scelti, imposta la stanza come iniziata
    if (allReady && team0Count === 2 && team1Count === 2) {
      await prisma.gameRoom.update({
        where: { id: room.id },
        data: { started: true },
      });

      // Notifico tutti nella room che la partita sta iniziando
      io.to(roomCode).emit("game_started", {});

      try {
        //^ Chiama setupRound per creare il primo round
        const { callerPlayerId } = await setupRound(room.id, 1);

        // Start briscola timer for the caller
        const callerPlayer = room.players.find(
          (p: any) => p.id === callerPlayerId,
        );
        if (callerPlayer) {
          startTurnTimer(roomCode, callerPlayer.userId, "choose_briscola");
        }
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

export const leaveRoom = async (req: Request, res: Response) => {
  const { roomCode } = req.params;
  const userId = req.user!.userId;

  try {
    const room = await prisma.gameRoom.findUnique({
      where: { code: roomCode },
      include: { players: true },
    });

    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    const player = room.players.find((p) => p.userId === userId);
    if (!player) {
      return res.status(404).json({ error: "Player not found in room" });
    }

    const io = getSocketInstance();

    if (room.players.length === 1) {
      // 🔥 Sei l’unico player: cancella la stanza
      await prisma.player.deleteMany({
        where: { gameRoomId: room.id },
      });
      await prisma.gameRoom.delete({
        where: { id: room.id },
      });


      io.to("lobby").emit("room_deleted", { roomCode }); // opzionale, se vuoi aggiornare la lobby

      return res.status(200).json({ success: true, deletedRoom: true });
    } else {
      // 🔥 Altri player presenti: rimuovi solo il Player
      await prisma.player.delete({
        where: { id: player.id },
      });

      io.to(roomCode).emit("player_left", { userId });


      return res.status(200).json({ success: true, deletedRoom: false });
    }
  } catch (error) {
    console.error("Error while leaving room:", error);
    return res.status(500).json({ error: "Failed to leave room" });
  }
};

export const getExitedRooms = async (req: Request, res: Response) => {
  const userId = req.user!.userId;

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
};
