// src/controllers/roomController.ts

import { Request, Response } from "express";
import { prisma } from "../db";
import { generateRoomCode } from "../utils/generateRoomCode";
import { setupRound } from "../services/gameService";

export const createRoom = async (req: Request, res: Response) => {
  /**
   * Crea una nuova stanza di gioco con un codice univoco e aggiunge il creatore come primo giocatore.
   *
   * @param userId ID dell'utente che crea la stanza (dal body della richiesta)
   * @return La stanza di gioco creata
   *
   * @note Il codice della stanza è univoco e generato casualmente
   * @note Il creatore della stanza è automaticamente il primo giocatore (seat 0)
   */

  const { userId } = req.body;
  if (!userId) {
    return res
      .status(400)
      .json({ error: "User ID is required to create a room" });
  }

  try {
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
  /**
   * Recupera tutte le stanze di gioco disponibili che non sono piene (meno di 4 giocatori)
   * e a cui l'utente specificato non ha ancora partecipato.
   *
   * @param userId ID dell'utente che cerca stanze (dal query param)
   * @return Lista di stanze di gioco disponibili
   *
   * @note Una stanza è considerata disponibile se non è iniziata, non è finita,
   *      ha meno di 4 giocatori e l'utente non è già un giocatore in quella stanza.
   *     Una stanza piena (4 giocatori) non viene inclusa nei risultati.
   */
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

    //^ Filtra le stanze che non sono piene (meno di 4 giocatori)
    const availableRooms = rooms.filter((room) => room.players.length < 4);

    return res.status(200).json(availableRooms);
  } catch (error) {
    console.error("Error fetching available rooms:", error);
    return res.status(500).json({ error: "Failed to fetch available rooms" });
  }
};

export const joinRoom = async (req: Request, res: Response) => {
  /**
   * Permette a un utente di unirsi a una stanza di gioco esistente se non è piena e non è iniziata.
   *
   * @param roomCode Codice della stanza di gioco (dal body della richiesta)
   * @param userId ID dell'utente che vuole unirsi alla stanza (dal body della richiesta)
   * @return La stanza di gioco aggiornata con il nuovo giocatore
   *
   * @note Controlla che la stanza esista, non sia iniziata, non sia piena (max 4 giocatori)
   *      e che l'utente non sia già un giocatore in quella stanza.
   */
  const { roomCode, userId } = req.body;
  if (!roomCode || !userId) {
    return res
      .status(400)
      .json({ error: "Room code and User ID are required to join a room" });
  }

  try {
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
      (player) => player.userId === userId
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
  const { userId, isReady } = req.body;

  if (typeof isReady !== "boolean" || !userId) {
    return res
      .status(400)
      .json({ error: "User ID and ready status are required" });
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

    //^ Se tutti i Player sono pronti e i team sono pieni e scelti, imposta la stanza come iniziata
    if (allReady && team0Count === 2 && team1Count === 2) {
      await prisma.gameRoom.update({
        where: { id: room.id },
        data: { started: true },
      });
      try {
        //^ Chiama setupRound per creare il primo round
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
