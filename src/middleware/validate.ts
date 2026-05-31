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
 * Required: gameRoomId (number), suit (valid Suit enum).
 * playerId is derived server-side from req.user — never trust the client.
 */
export const validateChooseBriscola = (req: Request, res: Response, next: NextFunction) => {
  const { gameRoomId, suit } = req.body;

  if (gameRoomId === undefined || typeof gameRoomId !== "number" || !Number.isInteger(gameRoomId)) {
    return res.status(400).json({ error: "gameRoomId must be a valid integer" });
  }

  if (!isValidSuit(suit)) {
    return res.status(400).json({
      error: `Invalid suit: "${suit}". Must be one of: ${VALID_SUITS.join(", ")}`,
    });
  }

  next();
};

const VALID_SIGNALS = ["striscio", "busso", "volo"] as const;

/**
 * Validates the body for POST /api/games/play-card
 * Required: roomCode (string), suit (valid Suit), value (valid Value)
 * Optional: signal (one of striscio/busso/volo, or null/undefined)
 * userId comes from req.user (JWT auth)
 */
export const validatePlayCard = (req: Request, res: Response, next: NextFunction) => {
  const { roomCode, suit, value, signal } = req.body;

  if (!roomCode || typeof roomCode !== "string") {
    return res.status(400).json({ error: "roomCode must be a non-empty string" });
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

  if (
    signal !== undefined &&
    signal !== null &&
    !VALID_SIGNALS.includes(signal)
  ) {
    return res.status(400).json({
      error: `Invalid signal: "${signal}". Must be one of: ${VALID_SIGNALS.join(", ")} (or null)`,
    });
  }

  next();
};

/**
 * Validates path params for GET /api/games/playable-cards/:roomCode
 * userId comes from req.user (JWT auth)
 */
export const validateGetPlayableCards = (req: Request, res: Response, next: NextFunction) => {
  const { roomCode } = req.params;

  if (!roomCode || typeof roomCode !== "string") {
    return res.status(400).json({ error: "roomCode path param is required" });
  }

  next();
};
