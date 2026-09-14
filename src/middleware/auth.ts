// src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import { JwtPayload } from "../utils/jwt";
import { verifyActiveSession } from "../auth/activeSession";
import {
  isTestAuthBypassEnabled,
  testRequestIdentity,
} from "../auth/testAuthBypass";
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
  const token = req.cookies?.authToken;

  // A real cookie is authoritative even in tests. This keeps the bypass from
  // masking invalid or expired login state.
  if (token !== undefined) {
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

  if (isTestAuthBypassEnabled()) {
    req.user = testRequestIdentity(req.headers) ?? undefined;
    return next();
  }

  return next(unauthorized());
};
