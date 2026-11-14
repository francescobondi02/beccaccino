import { Request, Response } from "express";
import { playCard } from "../game/transitions/cardPlay";
import { setBriscola } from "../game/transitions/round";
import { loadGameState } from "../game/liveGame";
import { requireUser } from "../http/request";
import { parseRoomCode } from "../http/input/rooms";
import { parsePlayedCard, parseSuit } from "../http/input/games";

// The caller gets the state that was pushed to them; it is read again only if that push failed.
export const chooseBriscola = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const roomCode = parseRoomCode(req.params.roomCode);
  const suit = parseSuit(req.body);
  const state = await setBriscola({ roomCode, userId, source: "human", suit });
  return res.status(200).json(state ?? (await loadGameState(roomCode, userId)));
};

export const handlePlayCard = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const roomCode = parseRoomCode(req.params.roomCode);
  const { card, signal } = parsePlayedCard(req.body);
  const state = await playCard({ roomCode, userId, source: "human", card, signal });
  return res.status(200).json(state ?? (await loadGameState(roomCode, userId)));
};

export const getGameState = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const roomCode = parseRoomCode(req.params.roomCode);
  return res.status(200).json(await loadGameState(roomCode, userId));
};
