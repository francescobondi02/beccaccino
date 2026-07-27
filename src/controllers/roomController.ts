// src/controllers/roomController.ts

import { Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { prisma } from "../db";
import { generateRoomCode } from "../utils/generateRoomCode";
import { startFirstRound } from "../services/gameService";
import { getSocketInstance } from "../socketInstance";
import { withRoomLock } from "../utils/roomLock";
import { logger } from "../logger";
import { BOT_TIERS, ensureBotUsers, isBotTier } from "../services/botService";
import { clearRoomTimerData, registerBotSeats } from "../services/turnTimer";

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
      // Socket failure is non-fatal — the room exists in the DB. Log but
      // don't block the response.
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
    const existingActiveGame = await prisma.player.findFirst({
      where: { userId, gameRoom: { started: true, finished: false } },
      include: { gameRoom: true },
    });

    if (existingActiveGame) {
      return res.status(409).json({
        error: "Sei già in una partita attiva",
        activeRoomCode: existingActiveGame.gameRoom.code,
      });
    }

    const botUserIds = await ensureBotUsers();
    const code = await generateUniqueRoomCode();

    // Seats are pre-assigned so the human gets seat 0, which GameTable renders
    // at the bottom of the table. startFirstRound → setupRound reassigns seats
    // by interleaving the teams in seat order (team0[0], team1[0], team0[1],
    // team1[1]); reading players back ordered by seat, that reproduces exactly
    // the assignment below, so the human stays put.
    const room = await prisma.gameRoom.create({
      data: {
        code,
        started: true,
        isPractice: true,
        players: {
          create: [
            { userId, seat: 0, team: 0, isReady: true },
            { userId: botUserIds[0], seat: 1, team: 1, isReady: true, botModel: tier },
            { userId: botUserIds[1], seat: 2, team: 0, isReady: true, botModel: tier },
            { userId: botUserIds[2], seat: 3, team: 1, isReady: true, botModel: tier },
          ],
        },
      },
    });

    // Must precede startFirstRound: it arms the caller's turn timer, which is
    // what dispatches the first bot move if the caller is a bot.
    registerBotSeats(
      code,
      botUserIds.map((botUserId) => ({ userId: botUserId, tier })),
    );

    await startFirstRound(room.id, code);

    logger.info({ roomCode: code, userId, tier }, "practice_game_started");

    return res.status(201).json({ code, tier });
  } catch (error) {
    Sentry.captureException(error, { extra: { userId, tier, op: "create_practice_room" } });
    (req.log ?? logger).error(
      { err: error, userId, tier },
      "create_practice_room_failed",
    );
    return res.status(500).json({ error: "Practice game creation failed" });
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

    // Serialize the room-full / already-in checks with the player.create per
    // room so two simultaneous joins can't both pass the checks and overfill
    // the room (same pattern as setPlayerReady below).
    const result = await withRoomLock(roomCode, async () => {
      //^ Troviamo la stanza a cui l'utente vuole unirsi
      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: true },
      });

      if (!room) return { status: 404, body: { error: "Room not found" } };

      if (room.started) {
        return { status: 400, body: { error: "Room has already started" } };
      }

      if (room.players.length >= 4) {
        return { status: 400, body: { error: "Room is full" } };
      }

      //^ Verifichiamo che l'utente non sia già un giocatore dentro quella stanza
      const alreadyInRoom = room.players.some(
        (player) => player.userId === userId,
      );
      if (alreadyInRoom) {
        return { status: 400, body: { error: "User already in the room" } };
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
        Sentry.captureException(socketError, {
          extra: { event: "join_room_broadcast", roomCode },
        });
        (req.log ?? logger).warn(
          { err: socketError, roomCode },
          "join_room_broadcast_failed",
        );
      }

      return { status: 200, body: updatedRoom };
    });

    return res.status(result.status).json(result.body);
  } catch (error) {
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
    // Serialize the read-update-start-game flow per room so two simultaneous
    // ready-up requests can't both observe allReady=true and both start the game.
    const result = await withRoomLock(roomCode, async () => {
      //^ Cerca la stanza attuale
      const room = await prisma.gameRoom.findUnique({
        where: { code: roomCode },
        include: { players: true },
      });

      if (!room) return { status: 404, body: { error: "Room not found" } };

      //^ Trova il player nella stanza
      const player = room.players.find((p) => p.userId === userId);
      if (!player) {
        return {
          status: 403,
          body: { error: "User is not a player in this room" },
        };
      }

      //^ Controlla che abbia scelto un team (non può mettersi Ready se non ha un team)
      if (player.team === null) {
        return {
          status: 403,
          body: { error: "Player must choose a team before readying up" },
        };
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
        return {
          status: 404,
          body: { error: "Room not found after update" },
        };
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

      //^ Se tutti i Player sono pronti, i team pieni, e la partita non è già iniziata,
      //^ atomicamente imposta started=true e fai partire il primo round.
      if (
        allReady &&
        team0Count === 2 &&
        team1Count === 2 &&
        !updatedRoom.started
      ) {
        // Conditional update: only flip to started=true if it's still false.
        // Prevents a second concurrent caller from re-starting the game.
        const flip = await prisma.gameRoom.updateMany({
          where: { id: room.id, started: false },
          data: { started: true },
        });

        if (flip.count === 1) {
          // We were the one that started the game.
          try {
            await startFirstRound(room.id, roomCode);
          } catch (error) {
            Sentry.captureException(error, {
              extra: { event: "first_round_setup", roomCode, userId },
            });
            (req.log ?? logger).error(
              { err: error, roomCode },
              "first_round_setup_failed",
            );
          }
        }
      }

      return {
        status: 200,
        body: { success: true, player: updatedPlayer, allReady },
      };
    });

    return res.status(result.status).json(result.body);
  } catch (error) {
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

    // A practice room has exactly one human, so their leaving always means
    // abandoning the whole game. Falling through to the partial-leave branch
    // below would strand the room started-but-never-finished with three orphaned
    // bot Player rows, and could re-arm a turn for the deleted human seat.
    if (room.isPractice) {
      // Stop the bot chain BEFORE deleting, so no in-flight bot move re-arms a
      // timer for a seat that no longer exists.
      clearRoomTimerData(roomCode);
      await deleteRoomAndPlay(room.id);

      io.to(roomCode).emit("practice_abandoned", { roomCode });
      logger.info({ roomCode, userId }, "practice_game_abandoned");

      return res.status(200).json({ success: true, deletedRoom: true });
    }

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

/**
 * Delete a room and everything played inside it, children first.
 *
 * No foreign key in the schema cascades, so a room that has been dealt cards
 * cannot simply be deleted — the order below is the dependency order, and the
 * transaction keeps a failure from leaving the room half-erased.
 */
async function deleteRoomAndPlay(gameRoomId: number): Promise<void> {
  const rounds = await prisma.round.findMany({
    where: { gameRoomId },
    select: { id: true },
  });
  const roundIds = rounds.map((r) => r.id);

  await prisma.$transaction([
    prisma.playedCard.deleteMany({ where: { hand: { roundId: { in: roundIds } } } }),
    prisma.playerCard.deleteMany({ where: { roundId: { in: roundIds } } }),
    prisma.hand.deleteMany({ where: { roundId: { in: roundIds } } }),
    prisma.round.deleteMany({ where: { gameRoomId } }),
    prisma.player.deleteMany({ where: { gameRoomId } }),
    prisma.gameRoom.delete({ where: { id: gameRoomId } }),
  ]);
}

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
