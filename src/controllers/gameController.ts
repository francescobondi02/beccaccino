// src/controllers/gameController.ts

import { Request, Response } from "express";
import { prisma } from "../db";
import { Suit } from "@prisma/client";
import { playCard, setBriscola } from "../services/gameService";
import { playableCards } from "../services/cardService";
import { getTurnTimerState } from "../services/turnTimer";

export const chooseBriscola = async (req: Request, res: Response) => {
  const { gameRoomId, playerId, suit } = req.body;

  try {
    const result = await setBriscola({ gameRoomId, playerId, suit });
    return res.status(200).json({
      message: "Briscola set successfully",
      round: result.round,
      hand: result.hand,
    });
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes("not found")) {
      return res.status(404).json({ error: message });
    }
    if (message.includes("not your turn") || message.includes("not in this")) {
      return res.status(403).json({ error: message });
    }
    if (message.includes("already set")) {
      return res.status(400).json({ error: message });
    }
    return res.status(500).json({ error: message });
  }
};

export const handlePlayCard = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { roomCode, suit, value, signal } = req.body;
    await playCard({ roomCode, userId, suit, value, signal });
    return res.status(200).json({ message: "Card played successfully" });
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes("not your turn") || message.includes("not in this")) {
      return res.status(403).json({ error: message });
    }
    if (message.includes("not found")) {
      return res.status(404).json({ error: message });
    }
    return res.status(400).json({ error: message });
  }
};

export const getPlayableCards = async (req: Request, res: Response) => {
  const { roomCode } = req.params;
  const userId = req.user!.userId;

  try {
    const cards = await playableCards({ roomCode, userId });
    return res.status(200).json({ playableCards: cards });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
};

export const getGameState = async (req: Request, res: Response) => {
  const { roomCode } = req.params;
  const userId = req.user!.userId;

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
      cricca: currentRound.cricca,
    },
    currentHandNumber: currentHandInProgress?.number ?? null,
    callerUserId,
    myCards,
    currentTurnUserId,
    playedCards,
    lastHandCards,
    totalPoints,
    turnTimer: getTurnTimerState(roomCode),
  });
};
