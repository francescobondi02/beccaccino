import { Request, Response } from "express";
import {
  parseJoinRoom,
  parsePracticeTier,
  parseReady,
  parseRoomCode,
  parseTeam,
} from "../http/input/rooms";
import { requireUser } from "../http/request";
import {
  chooseMultiplayerTeam,
  createMultiplayerRoom,
  createPracticeRoom as createPracticeRoomOperation,
  joinMultiplayerRoom,
  leaveOwnedRoom,
  pausePracticeRoom as pausePracticeRoomOperation,
  resumePracticeRoom as resumePracticeRoomOperation,
  setMultiplayerReady,
} from "../services/roomCoordinator";

export const createRoom = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  return res.status(201).json(await createMultiplayerRoom(userId));
};

export const createPracticeRoom = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const tier = parsePracticeTier(req.body);
  return res
    .status(201)
    .json(await createPracticeRoomOperation({ userId, tier }));
};

export const joinRoom = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const roomCode = parseJoinRoom(req.body);
  return res.status(200).json(
    await joinMultiplayerRoom({ roomCode, userId }),
  );
};

export const chooseTeam = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const roomCode = parseRoomCode(req.params.roomCode);
  const team = parseTeam(req.body);
  return res.status(200).json(
    await chooseMultiplayerTeam({ roomCode, userId, team }),
  );
};

export const setPlayerReady = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const roomCode = parseRoomCode(req.params.roomCode);
  const isReady = parseReady(req.body);
  return res.status(200).json(
    await setMultiplayerReady({ roomCode, userId, isReady }),
  );
};

export const leaveRoom = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const roomCode = parseRoomCode(req.params.roomCode);
  return res.status(200).json(await leaveOwnedRoom({ roomCode, userId }));
};

export const pausePracticeRoom = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const roomCode = parseRoomCode(req.params.roomCode);
  return res
    .status(200)
    .json(await pausePracticeRoomOperation({ roomCode, userId }));
};

export const resumePracticeRoom = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const roomCode = parseRoomCode(req.params.roomCode);
  return res
    .status(200)
    .json(await resumePracticeRoomOperation({ roomCode, userId }));
};
