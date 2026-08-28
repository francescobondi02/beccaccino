import { Request, Response } from "express";
import { parseRoomCode } from "../http/input/rooms";
import { requireUser } from "../http/request";
import {
  getRoomForUser,
  listExitedRooms,
  listRoomsForLobby,
} from "../services/roomQueries";

export const getAvailableRooms = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  return res.status(200).json(await listRoomsForLobby(userId));
};

export const getRoomByCode = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const roomCode = parseRoomCode(req.params.roomCode);
  return res.status(200).json(await getRoomForUser(roomCode, userId));
};

export const getExitedRooms = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  return res.status(200).json(await listExitedRooms(userId));
};
