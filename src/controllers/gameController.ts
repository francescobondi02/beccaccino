// src/controllers/gameController.ts

import { Request, Response } from "express";
import { prisma } from "../db";
import { Suit, Value } from "@prisma/client";
import { playCard } from "../services/gameService";
import { playableCards } from "../services/cardService";
import { getSocketInstance } from "../socketInstance";

export const chooseBriscola = async (req: Request, res: Response) => {
  /**
   * Funzione per scegliere la briscola in una partita di carte all'inizio del round.
   *
   * @param req Request contenente il body con:
   *  - gameRoomId: ID della stanza di gioco
   *  - playerId: ID del giocatore che sceglie la briscola
   *  - suit: Seme scelto come briscola (denari, coppe, spade, bastoni)
   *
   * @return void
   */
  const { gameRoomId, playerId, suit } = req.body;

  //^ Controlli preliminari
  const gameRoom = await prisma.gameRoom.findUnique({
    where: { id: gameRoomId },
    include: { players: true },
  });
  if (!gameRoom) {
    return res.status(404).json({ error: "Game room not found" });
  }

  const player = gameRoom.players.find((p) => p.id === playerId);
  if (!player) {
    return res.status(403).json({ error: "Player not in this game room" });
  }

  //^ Controllo che non sia già stata scelta una briscola per questo round
  const lastRound = await prisma.round.findFirst({
    where: { gameRoomId: gameRoom.id },
    orderBy: { number: "desc" },
  });

  if (!lastRound) {
    return res.status(500).json({ error: "No active round found" });
  }

  if (lastRound.briscola !== null) {
    return res
      .status(400)
      .json({ error: "Briscola already set for this round" });
  }

  //^ Imposto la briscola nel round corrente
  const currentRound = await prisma.round.findFirst({
    where: { gameRoomId: gameRoom.id },
    orderBy: { number: "desc" },
  });

  if (!currentRound) {
    return res.status(500).json({ error: "No active round found" });
  }

  if (currentRound.briscola !== null) {
    return res
      .status(400)
      .json({ error: "Briscola already set for this round" });
  }

  const updatedRound = await prisma.round.update({
    where: { id: currentRound.id },
    data: { briscola: suit },
  });

  if (!updatedRound) {
    return res.status(500).json({ error: "Failed to set briscola" });
  }

  //^ Creiamo la prima mano del round ora che la briscola è stata scelta
  try {
    const firstHand = await prisma.hand.create({
      data: {
        roundId: currentRound.id,
        number: 1,
        starterId: playerId, // Chi ha scelto la briscola inizia
      },
    });

    // Notifica tramite websocket la scelta della briscola + inizio prima mano
    const io = getSocketInstance();
    io.to(gameRoom.code).emit("briscola_chosen", {
      briscola: suit,
      roundNumber: currentRound.number,
      starterId: playerId,
    });

    return res.status(200).json({
      message: "Briscola set successfully",
      round: updatedRound,
      hand: firstHand,
    });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
};

export const handlePlayCard = async (req: Request, res: Response) => {
  try {
    const { roomCode, userId, suit, value } = req.body;
    await playCard({ roomCode, userId, suit, value });
    return res.status(200).json({ message: "Card played successfully" });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
};

export const getPlayableCards = async (req: Request, res: Response) => {
  const { roomCode } = req.params;
  const userId = parseInt(req.query.userId as string);

  if (!roomCode || isNaN(userId)) {
    return res.status(400).json({ error: "roomCode and userId required" });
  }

  try {
    const cards = await playableCards({ roomCode, userId });
    return res.status(200).json({ playableCards: cards });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
};

export const getGameState = async (req: Request, res: Response) => {
  const { roomCode } = req.params;
  const userId = parseInt(req.query.userId as string);

  // Verifico che l'utente sia nella stanza
  const gameRoom = await prisma.gameRoom.findUnique({
    where: { code: roomCode },
    include: {
      players: {
        include: {
          user: true,
        },
      },
    },
  });

  if (!gameRoom) {
    return res.status(404).json({ error: "Room not found" });
  }

  const isPlayerInRoom = gameRoom.players.some((p) => p.userId === userId);
  if (!isPlayerInRoom) {
    return res.status(403).json({ error: "You are not in this room" });
  }

  if (!gameRoom.started) {
    return res.status(400).json({ error: "Game has not started yet" });
  }

  // Trova il round corrente (l'ultimo creato)
  const currentRound = await prisma.round.findFirst({
    where: { gameRoomId: gameRoom.id },
    orderBy: { number: "desc" },
    include: { hands: { orderBy: { number: "asc" }, take: 1 } },
  });

  if (!currentRound) {
    return res.status(404).json({ error: "No active round found" });
  }

  // Determina chi deve chiamare la briscola
  let callerPlayerId: number | null = null;

  if (currentRound.number === 1) {
    // Round 1: chi ha il 4 di denara
    const quattroDeNara = await prisma.playerCard.findFirst({
      where: {
        roundId: currentRound.id,
        suit: "denara",
        value: "quattro",
      },
    });
    callerPlayerId = quattroDeNara?.playerId ?? null;
  } else {
    // Round 2+: il player con seat successivo al caller del round precedente
    const prevRound = await prisma.round.findFirst({
      where: { gameRoomId: gameRoom.id, number: currentRound.number - 1 },
      include: { hands: { orderBy: { number: "asc" }, take: 1 } },
    });
    if (prevRound && prevRound.hands.length > 0) {
      const prevCaller = gameRoom.players.find(
        (p) => p.id === prevRound.hands[0].starterId,
      );
      if (prevCaller !== undefined && prevCaller.seat !== null) {
        const nextSeat = (prevCaller.seat + 1) % 4;
        const nextPlayer = gameRoom.players.find((p) => p.seat === nextSeat);
        callerPlayerId = nextPlayer?.id ?? null;
      }
    }
  }

  // Converti callerPlayerId in callerUserId per il frontend
  const callerPlayer = gameRoom.players.find((p) => p.id === callerPlayerId);
  const callerUserId = callerPlayer?.userId ?? null;

  // Carte del giocatore corrente per questo round
  const myPlayerRecord = gameRoom.players.find((p) => p.userId === userId);
  const myCards = myPlayerRecord
    ? await prisma.playerCard.findMany({
        where: {
          playerId: myPlayerRecord.id,
          roundId: currentRound.id,
        },
        orderBy: [{ suit: "asc" }, { value: "asc" }],
      })
    : [];

  // Determina di chi è il turno attuale
  let currentTurnUserId: number | null = null;

  if (currentRound.briscola === null) {
    // Se la briscola non è stata ancora scelta, il turno è del caller
    currentTurnUserId = callerUserId;
  } else {
    // La briscola è stata scelta, cerco l'ultima mano
    const lastHand = await prisma.hand.findFirst({
      where: { roundId: currentRound.id },
      orderBy: { number: "desc" },
      include: { cards: { orderBy: { position: "asc" } } },
    });

    if (!lastHand) {
      // Nessuna mano ancora, il turno è dello starter (che è il caller dopo la briscola)
      currentTurnUserId = callerUserId;
    } else {
      // C'è una mano
      if (lastHand.cards.length < 4) {
        // Mano in corso: il turno è del prossimo giocatore
        // L'ordine è: starterId, poi (starterId+1)%4, (starterId+2)%4, (starterId+3)%4
        const starterPlayer = gameRoom.players.find(
          (p) => p.id === lastHand.starterId,
        );
        if (starterPlayer && starterPlayer.seat !== null) {
          const nextSeat = (starterPlayer.seat + lastHand.cards.length) % 4;
          const nextPlayer = gameRoom.players.find((p) => p.seat === nextSeat);
          currentTurnUserId = nextPlayer?.userId ?? null;
        }
      } else {
        // Mano completata (4 carte): il turno è del winner dell'ultima mano
        if (lastHand.winnerId) {
          const winnerPlayer = gameRoom.players.find(
            (p) => p.id === lastHand.winnerId,
          );
          currentTurnUserId = winnerPlayer?.userId ?? null;
        }
      }
    }
  }

  // Recupera le carte attualmente giocate (sul tavolo)
  const currentHandInProgress = await prisma.hand.findFirst({
    where: { roundId: currentRound.id, winnerId: null },
    orderBy: { number: "desc" },
    include: {
      cards: {
        orderBy: { position: "asc" },
        include: { player: { include: { user: true } } },
      },
    },
  });

  const playedCards =
    currentHandInProgress?.cards.map((card) => ({
      playerId: card.playerId,
      userId: card.player.userId,
      suit: card.suit,
      value: card.value,
      position: card.position,
    })) ?? [];

  // Recupera le carte dell'ultima mano completata (per "Ultima mano")
  const lastCompletedHand = await prisma.hand.findFirst({
    where: { roundId: currentRound.id, winnerId: { not: null } },
    orderBy: { number: "desc" },
    include: {
      cards: {
        orderBy: { position: "asc" },
        include: { player: { include: { user: true } } },
      },
    },
  });

  const lastHandCards =
    lastCompletedHand?.cards.map((card) => ({
      playerId: card.playerId,
      userId: card.player.userId,
      suit: card.suit,
      value: card.value,
      position: card.position,
    })) ?? [];

  // Calcola i punti totali sommando tutti i round completati
  const completedRounds = await prisma.round.findMany({
    where: {
      gameRoomId: gameRoom.id,
      winnerTeam: { not: null }, // Solo round completati
    },
    select: {
      team0Points: true,
      team1Points: true,
      team0Figures: true,
      team1Figures: true,
    },
  });

  const totalPoints = completedRounds.reduce(
    (acc, round) => ({
      team0Points: acc.team0Points + round.team0Points,
      team1Points: acc.team1Points + round.team1Points,
      team0Figures: acc.team0Figures + round.team0Figures,
      team1Figures: acc.team1Figures + round.team1Figures,
    }),
    { team0Points: 0, team1Points: 0, team0Figures: 0, team1Figures: 0 },
  );

  return res.status(200).json({
    round: {
      id: currentRound.id,
      number: currentRound.number,
      briscola: currentRound.briscola,
    },
    callerUserId,
    myCards,
    currentTurnUserId,
    playedCards,
    lastHandCards,
    totalPoints,
  });
};
