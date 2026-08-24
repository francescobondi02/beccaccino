// src/controllers/gameController.ts

import { Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { prisma } from "../db";
import {
  playCard,
  setBriscola,
} from "../services/turnCoordinator";
import { GameError } from "../utils/gameError";
import { playableCards } from "../services/cardService";
import { resetTimeoutCount } from "../services/turnTimer";
import { logger } from "../logger";
import { loadGameState } from "../services/gameState";

export const chooseBriscola = async (req: Request, res: Response) => {
  const { gameRoomId, suit } = req.body;
  const userId = req.user?.userId;

  if (!userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  // Derive playerId server-side from the authenticated userId so a user cannot
  // pass an arbitrary playerId in the request body and impersonate another player.
  const player = await prisma.player.findFirst({
    where: { gameRoomId, userId },
    select: { id: true },
  });

  if (!player) {
    return res.status(403).json({ error: "Player not in this game room" });
  }

  try {
    const result = await setBriscola({ gameRoomId, playerId: player.id, suit });
    // A real human action: this turn was not abandoned.
    resetTimeoutCount(result.roomCode, userId);
    return res.status(200).json({
      message: "Briscola set successfully",
      round: result.round,
      hand: result.hand,
    });
  } catch (error) {
    if (error instanceof GameError) {
      return res.status(error.status).json({ error: error.message });
    }
    return res.status(500).json({ error: (error as Error).message });
  }
};

export const handlePlayCard = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { roomCode, suit, value, signal } = req.body;
    await playCard({ roomCode, userId, suit, value, signal });
    // A real human action: this turn was not abandoned.
    resetTimeoutCount(roomCode, userId);
    return res.status(200).json({ message: "Card played successfully" });
  } catch (error) {
    if (error instanceof GameError) {
      return res.status(error.status).json({ error: error.message });
    }
    return res.status(400).json({ error: (error as Error).message });
  }
};

export const getPlayableCards = async (req: Request, res: Response) => {
  const { roomCode } = req.params;
  const userId = req.user!.userId;

  try {
    const cards = await playableCards({ roomCode, userId });
    return res.status(200).json({ playableCards: cards });
  } catch (error) {
    if (error instanceof GameError) {
      return res.status(error.status).json({ error: error.message });
    }
    logger.error({ err: error, roomCode, userId }, "get_playable_cards_failed");
    return res.status(500).json({ error: "Failed to fetch playable cards" });
  }
};

export const getGameState = async (req: Request, res: Response) => {
  const { roomCode } = req.params;
  const userId = req.user!.userId;

  try {
    return res.status(200).json(await loadGameState(roomCode, userId));
  } catch (error) {
    if (error instanceof GameError) {
      return res.status(error.status).json({ error: error.message });
    }
    Sentry.captureException(error, {
      extra: { op: "get_game_state", roomCode, userId },
    });
    logger.error({ err: error, roomCode, userId }, "get_game_state_failed");
    return res.status(500).json({ error: "Failed to fetch game state" });
  }
};
