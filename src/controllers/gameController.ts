// src/controllers/gameController.ts

import { Request, Response } from "express";
import { prisma } from "../db";
import { Suit, Value } from "@prisma/client";
import { playCard } from "../services/gameService";
import { playableCards } from "../services/cardService";

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

    //* NOTIFICA TRAMITE WEBSOCKET LA SCELTA DELLA BRISCOLA + INIZIO PRIMA MANO

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
