// src/middleware/validate.ts
/**
 * Input validation middleware for game-related endpoints.
 * Ensures enum values (Suit, Value) are valid before reaching controllers.
 */

import { Request, Response, NextFunction } from "express";
import {
  CARD_SIGNALS,
  isCardSignal,
  isSuit,
  isValue,
  SUITS,
  VALUES,
} from "../domain/cards";
import { badRequest } from "../http/errors";

/**
 * Validates the body for POST /api/games/choose-briscola
 * Required: gameRoomId (number), suit (valid Suit enum).
 * playerId is derived server-side from req.user — never trust the client.
 */
export const validateChooseBriscola = (req: Request, _res: Response, next: NextFunction) => {
  const { gameRoomId, suit } = req.body;

  if (gameRoomId === undefined || typeof gameRoomId !== "number" || !Number.isInteger(gameRoomId)) {
    return next(badRequest("gameRoomId must be a valid integer"));
  }

  if (!isSuit(suit)) {
    return next(
      badRequest(
        `Invalid suit: "${suit}". Must be one of: ${SUITS.join(", ")}`,
      ),
    );
  }

  next();
};

/**
 * Validates the body for POST /api/games/play-card
 * Required: roomCode (string), suit (valid Suit), value (valid Value)
 * Optional: signal (one of striscio/busso/volo, or null/undefined)
 * userId comes from req.user (JWT auth)
 */
export const validatePlayCard = (req: Request, _res: Response, next: NextFunction) => {
  const { roomCode, suit, value, signal } = req.body;

  if (!roomCode || typeof roomCode !== "string") {
    return next(badRequest("roomCode must be a non-empty string"));
  }

  if (!isSuit(suit)) {
    return next(
      badRequest(
        `Invalid suit: "${suit}". Must be one of: ${SUITS.join(", ")}`,
      ),
    );
  }

  if (!isValue(value)) {
    return next(
      badRequest(
        `Invalid value: "${value}". Must be one of: ${VALUES.join(", ")}`,
      ),
    );
  }

  if (
    signal !== undefined &&
    signal !== null &&
    !isCardSignal(signal)
  ) {
    return next(
      badRequest(
        `Invalid signal: "${signal}". Must be one of: ${CARD_SIGNALS.join(", ")} (or null)`,
      ),
    );
  }

  next();
};

/**
 * Validates path params for GET /api/games/playable-cards/:roomCode
 * userId comes from req.user (JWT auth)
 */
export const validateGetPlayableCards = (req: Request, _res: Response, next: NextFunction) => {
  const { roomCode } = req.params;

  if (!roomCode || typeof roomCode !== "string") {
    return next(badRequest("roomCode path param is required"));
  }

  next();
};
