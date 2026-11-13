// src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import { JwtPayload } from "../utils/jwt";
import { verifyActiveSession } from "../auth/activeSession";
import {
  isTestAuthBypassEnabled,
  testRequestIdentity,
} from "../auth/testAuthBypass";
import { forbidden, unauthorized } from "../http/errors";

// Estende Request per includere user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

// The cookie is SameSite=None in production, so a foreign page could submit a
// form with it. Browsers always label their own origin; Bearer clients are immune.
function isCrossSiteMutation(req: Request): boolean {
  const origin = req.headers.origin;
  return (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    origin !== undefined &&
    origin !== process.env.FRONTEND_URL &&
    req.headers["sec-fetch-site"] !== "same-origin"
  );
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

  // Explicit credentials never fall through to a cookie or the test bypass.
  if (authorization !== undefined || token !== undefined) {
    if (typeof token !== "string" || token.length === 0) {
      return next(unauthorized("Invalid or expired token"));
    }
    if (authorization === undefined && isCrossSiteMutation(req)) {
      return next(forbidden("Cross-site request rejected"));
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
