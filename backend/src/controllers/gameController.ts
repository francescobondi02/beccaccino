// src/controllers/gameController.ts

import { Request, Response } from "express";
import { playCard } from "../game/transitions/cardPlay";
import { setBriscola } from "../game/transitions/round";
import { loadGameState } from "../services/gameState";
import { requireUser } from "../http/request";
import { parseRoomCode } from "../http/input/rooms";
import type { GameState } from "../contract/game";

// The caller gets the same state that was pushed to them; read it again only if that push failed.
async function respondWithState(
  res: Response,
  roomCode: string,
  userId: number,
  states: Map<number, GameState>,
) {
  return res.status(200).json(states.get(userId) ?? (await loadGameState(roomCode, userId)));
}

export const chooseBriscola = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const roomCode = parseRoomCode(req.params.roomCode);
  const states = await setBriscola({ roomCode, userId, suit: req.body.suit });
  return respondWithState(res, roomCode, userId, states);
};

export const handlePlayCard = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const roomCode = parseRoomCode(req.params.roomCode);
  const { suit, value, signal } = req.body;
  const states = await playCard({ roomCode, userId, suit, value, signal });
  return respondWithState(res, roomCode, userId, states);
};

export const getGameState = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const roomCode = parseRoomCode(req.params.roomCode);
  return res.status(200).json(await loadGameState(roomCode, userId));
};
