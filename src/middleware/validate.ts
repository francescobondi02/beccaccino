// src/middleware/validate.ts
/**
 * Input validation middleware for game-related endpoints.
 * Ensures enum values (Suit, Value) are valid before reaching controllers.
 */

import { Request, Response, NextFunction } from "express";

// Valid enum values matching Prisma schema
const VALID_SUITS = ["denara", "coppe", "spade", "bastoni"] as const;
const VALID_VALUES = [
  "asso", "due", "tre", "quattro", "cinque",
  "sei", "sette", "fante", "cavallo", "re",
] as const;

type ValidSuit = (typeof VALID_SUITS)[number];
type ValidValue = (typeof VALID_VALUES)[number];

export function isValidSuit(suit: unknown): suit is ValidSuit {
  return typeof suit === "string" && VALID_SUITS.includes(suit as ValidSuit);
}

export function isValidValue(value: unknown): value is ValidValue {
  return typeof value === "string" && VALID_VALUES.includes(value as ValidValue);
}

/**
 * Validates the body for POST /api/games/choose-briscola
 * Required: gameRoomId (number), playerId (number), suit (valid Suit enum)
 */
export const validateChooseBriscola = (req: Request, res: Response, next: NextFunction) => {
  const { gameRoomId, playerId, suit } = req.body;

  if (gameRoomId === undefined || typeof gameRoomId !== "number" || !Number.isInteger(gameRoomId)) {
    return res.status(400).json({ error: "gameRoomId must be a valid integer" });
  }

  if (playerId === undefined || typeof playerId !== "number" || !Number.isInteger(playerId)) {
    return res.status(400).json({ error: "playerId must be a valid integer" });
  }

  if (!isValidSuit(suit)) {
    return res.status(400).json({
      error: `Invalid suit: "${suit}". Must be one of: ${VALID_SUITS.join(", ")}`,
    });
  }

  next();
};

/**
 * Validates the body for POST /api/games/play-card
 * Required: roomCode (string), userId (number), suit (valid Suit), value (valid Value)
 */
export const validatePlayCard = (req: Request, res: Response, next: NextFunction) => {
  const { roomCode, userId, suit, value } = req.body;

  if (!roomCode || typeof roomCode !== "string") {
    return res.status(400).json({ error: "roomCode must be a non-empty string" });
  }

  if (userId === undefined || typeof userId !== "number" || !Number.isInteger(userId)) {
    return res.status(400).json({ error: "userId must be a valid integer" });
  }

  if (!isValidSuit(suit)) {
    return res.status(400).json({
      error: `Invalid suit: "${suit}". Must be one of: ${VALID_SUITS.join(", ")}`,
    });
  }

  if (!isValidValue(value)) {
    return res.status(400).json({
      error: `Invalid value: "${value}". Must be one of: ${VALID_VALUES.join(", ")}`,
    });
  }

  next();
};

/**
 * Validates query params for GET /api/games/playable-cards/:roomCode
 * Required: userId (numeric query param)
 */
export const validateGetPlayableCards = (req: Request, res: Response, next: NextFunction) => {
  const { roomCode } = req.params;
  const userId = req.query.userId;

  if (!roomCode || typeof roomCode !== "string") {
    return res.status(400).json({ error: "roomCode path param is required" });
  }

  if (!userId) {
    return res.status(400).json({ error: "userId query param is required" });
  }

  const parsed = parseInt(userId as string, 10);
  if (isNaN(parsed) || parsed < 1) {
    return res.status(400).json({ error: "userId must be a valid positive integer" });
  }

  next();
};
