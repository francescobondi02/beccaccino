import { Response } from "express";
import { generateToken } from "../utils/jwt";

// La ENV VAR specifica se siamo in production. Il Dockerfile del backend la specifica, mentre in locale non è definita.
const isProduction = process.env.NODE_ENV === "production";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProduction,
  sameSite: (isProduction ? "none" : "strict") as "none" | "strict",
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
