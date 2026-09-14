import { Response } from "express";
import { generateToken } from "../utils/jwt";
import { frontendOrigin } from "./frontendOrigin";

const isProduction = process.env.NODE_ENV === "production";
const isCrossOrigin =
  isProduction &&
  !frontendOrigin().includes(process.env.RENDER_EXTERNAL_HOSTNAME || "");

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProduction,
  sameSite: (isCrossOrigin ? "none" : "strict") as "none" | "strict",
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
