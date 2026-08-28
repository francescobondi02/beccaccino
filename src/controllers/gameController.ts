// src/controllers/gameController.ts

import { Request, Response } from "express";
import { prisma } from "../db";
import { playCard, setBriscola } from "../services/turnCoordinator";
import { playableCards } from "../services/cardService";
import { resetTimeoutCount } from "../services/turnTimer";
import { loadGameState } from "../services/gameState";
import { forbidden } from "../http/errors";
import { requireUser } from "../http/request";

export const chooseBriscola = async (req: Request, res: Response) => {
  const { gameRoomId, suit } = req.body;
  const { userId } = requireUser(req);

  // Derive playerId server-side from the authenticated userId so a user cannot
  // pass an arbitrary playerId in the request body and impersonate another player.
  const player = await prisma.player.findFirst({
    where: { gameRoomId, userId },
    select: { id: true },
  });

  if (!player) {
    throw forbidden("Player not in this game room");
  }

  const result = await setBriscola({ gameRoomId, playerId: player.id, suit });
  resetTimeoutCount(result.roomCode, userId);
  return res.status(200).json({
    message: "Briscola set successfully",
    round: result.round,
    hand: result.hand,
  });
};

export const handlePlayCard = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const { roomCode, suit, value, signal } = req.body;
  await playCard({ roomCode, userId, suit, value, signal });
  resetTimeoutCount(roomCode, userId);
  return res.status(200).json({ message: "Card played successfully" });
};

export const getPlayableCards = async (req: Request, res: Response) => {
  const { roomCode } = req.params;
  const { userId } = requireUser(req);
  const cards = await playableCards({ roomCode, userId });
  return res.status(200).json({ playableCards: cards });
};

export const getGameState = async (req: Request, res: Response) => {
  const { roomCode } = req.params;
  const { userId } = requireUser(req);
  return res.status(200).json(await loadGameState(roomCode, userId));
};
