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
} from "../domain/game/cards";
import { badRequest } from "../http/errors";

/** Validates the body for POST /api/games/:roomCode/briscola: suit (valid Suit enum). */
export const validateChooseBriscola = (req: Request, _res: Response, next: NextFunction) => {
  const { suit } = req.body ?? {};

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
 * Validates the body for POST /api/games/:roomCode/cards
 * Required: suit (valid Suit), value (valid Value)
 * Optional: signal (one of striscio/busso/volo, or null/undefined)
 */
export const validatePlayCard = (req: Request, _res: Response, next: NextFunction) => {
  const { suit, value, signal } = req.body ?? {};

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
