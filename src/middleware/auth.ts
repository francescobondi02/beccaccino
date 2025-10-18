// src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import { verifyToken, JwtPayload } from "../utils/jwt";

// Estende Request per includere user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export const authenticateToken = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!req.cookies || !req.cookies.authToken) {
    console.log("Nessun cookie di autenticazione trovato");
    return res.status(401).json({ error: "Authentication required" });
  }

  const token = req.cookies.authToken;

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(403).json({ error: "Invalid or expired token" });
  }

  req.user = decoded;
  next();
};

// Middleware opzionale: continua anche senza token
export const optionalAuth = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const token = req.cookies.authToken;

  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
    }
  }

  next();
};
