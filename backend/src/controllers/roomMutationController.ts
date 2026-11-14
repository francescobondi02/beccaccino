import { Request, Response } from "express";
import {
  parsePracticeTier,
  parseReady,
  parseRoomCode,
  parseRoomBotTier,
  parseTeam,
} from "../http/input/rooms";
import { requireUser } from "../http/request";
import {
  chooseMultiplayerTeam,
  configureMultiplayerBots,
  createMultiplayerRoom,
  joinMultiplayerRoom,
  setMultiplayerReady,
} from "../services/multiplayerRooms";
import {
  createPracticeRoom as createPracticeRoomOperation,
  setPracticePaused,
} from "../services/practiceRooms";
import { leaveRoom as leaveRoomOperation } from "../services/leaveRoom";
import { resumePlayerControl as resumePlayerControlOperation } from "../services/playerControl";

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
  const roomCode = parseRoomCode(req.params.roomCode);
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

export const setRoomBots = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const roomCode = parseRoomCode(req.params.roomCode);
  const tier = parseRoomBotTier(req.body);
  return res.status(200).json(
    await configureMultiplayerBots({ roomCode, userId, tier }),
  );
};

export const leaveRoom = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const roomCode = parseRoomCode(req.params.roomCode);
  const onlyIfWaiting = req.body?.onlyIfWaiting === true;
  return res
    .status(200)
    .json(await leaveRoomOperation({ roomCode, userId, onlyIfWaiting }));
};

export const resumePlayerControl = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const roomCode = parseRoomCode(req.params.roomCode);
  return res.status(200).json(await resumePlayerControlOperation(roomCode, userId));
};

export const pausePracticeRoom = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const roomCode = parseRoomCode(req.params.roomCode);
  return res
    .status(200)
    .json(await setPracticePaused({ roomCode, userId }, true));
};

export const resumePracticeRoom = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const roomCode = parseRoomCode(req.params.roomCode);
  return res
    .status(200)
    .json(await setPracticePaused({ roomCode, userId }, false));
};
