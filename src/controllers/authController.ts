import { Request, Response } from "express";
import { clearAuthCookie, setAuthCookie } from "../http/authCookie";
import {
  parseLoginInput,
  parseRegistrationInput,
} from "../http/input/users";
import { loginUser, registerUser } from "../services/userAuth";

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

export const logout = async (_req: Request, res: Response) => {
  clearAuthCookie(res);
  return res.status(200).json({ message: "Logged out successfully" });
};
