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
  const token = authorization === undefined
    ? req.cookies?.authToken
    : /^Bearer +(\S+)$/i.exec(authorization)?.[1];

  // Explicit credentials never fall through to a cookie.
  if (authorization !== undefined || token !== undefined) {
    if (typeof token !== "string" || token.length === 0) {
      return next(unauthorized("Invalid or expired token"));
    }

    try {
      const session = await verifyActiveSession(token);
      if (!session) {
        return next(unauthorized("Invalid or expired token"));
      }

      req.user = session;
      return next();
    } catch (error) {
      return next(error);
    }
  }

  return next(unauthorized());
};
