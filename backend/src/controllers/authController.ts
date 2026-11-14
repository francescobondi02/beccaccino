import { Request, Response } from "express";
import { clearAuthCookie, setAuthCookie } from "../http/authCookie";
import {
  parseLoginInput,
  parseRegistrationInput,
} from "../http/input/users";
import { loginUser, registerUser } from "../services/userAuth";
import { generateToken } from "../utils/jwt";

export const register = async (req: Request, res: Response) => {
  const user = await registerUser(parseRegistrationInput(req.body));
  setAuthCookie(res, user);
  return res.status(201).json(user);
};

export const login = async (req: Request, res: Response) => {
  const user = await loginUser(parseLoginInput(req.body));
  setAuthCookie(res, user);
  return res.status(200).json(user);
};

function sendNativeSession(
  res: Response,
  status: number,
  user: { id: number; username: string },
) {
  const token = generateToken({ userId: user.id, username: user.username });
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json({ user, token });
}

export const nativeRegister = async (req: Request, res: Response) =>
  sendNativeSession(res, 201, await registerUser(parseRegistrationInput(req.body)));

export const nativeLogin = async (req: Request, res: Response) =>
  sendNativeSession(res, 200, await loginUser(parseLoginInput(req.body)));

export const logout = async (_req: Request, res: Response) => {
  clearAuthCookie(res);
  return res.status(200).json({ message: "Logged out successfully" });
};
