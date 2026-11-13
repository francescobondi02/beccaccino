import { Response } from "express";
import { generateToken } from "../utils/jwt";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export function setAuthCookie(
  response: Response,
  user: { id: number; username: string },
): void {
  response.cookie(
    "authToken",
    generateToken({ userId: user.id, username: user.username }),
    COOKIE_OPTIONS,
  );
}

export function clearAuthCookie(response: Response): void {
  response.clearCookie("authToken", COOKIE_OPTIONS);
}
