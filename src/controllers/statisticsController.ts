import { Request, Response } from "express";
import { requireUser } from "../http/request";
import {
  getLeaderboardStatistics,
  getUserStatistics,
} from "../services/statistics";

export const getUserStats = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  return res.status(200).json(await getUserStatistics(userId));
};

export const getLeaderboard = async (_req: Request, res: Response) => {
  return res.status(200).json(await getLeaderboardStatistics());
};
