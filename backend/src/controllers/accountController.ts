import { Request, Response } from "express";
import { clearAuthCookie, setAuthCookie } from "../http/authCookie";
import { parseUsernameUpdate } from "../http/input/users";
import { requireUser } from "../http/request";
import {
  deleteAccount,
  getAccount,
  updateUsername,
} from "../services/account";

export const getCurrentUser = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  return res.status(200).json(await getAccount(userId));
};

export const updateCurrentUser = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  const user = await updateUsername(
    userId,
    parseUsernameUpdate(req.body),
  );
  setAuthCookie(res, user);
  return res.status(200).json(user);
};

export const deleteCurrentUser = async (req: Request, res: Response) => {
  const { userId } = requireUser(req);
  await deleteAccount(userId);
  clearAuthCookie(res);
  return res.status(200).json({ message: "Account deleted successfully" });
};
