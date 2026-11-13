// src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import { JwtPayload } from "../utils/jwt";
import { verifyActiveSession } from "../auth/activeSession";
import { unauthorized } from "../http/errors";

// Estende Request per includere user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export const authenticateToken = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const authorization = req.headers.authorization;
  if (authorization === undefined && req.cookies?.authToken === undefined) {
    return next(unauthorized());
  }

  // Explicit credentials never fall through to a cookie.
  const token = authorization === undefined
    ? req.cookies.authToken
    : /^Bearer +(\S+)$/i.exec(authorization)?.[1];
  if (typeof token !== "string" || token.length === 0) {
    return next(unauthorized("Invalid or expired token"));
  }

  try {
    const session = await verifyActiveSession(token);
    if (!session) return next(unauthorized("Invalid or expired token"));

    req.user = session;
    next();
  } catch (error) {
    next(error);
  }
};
