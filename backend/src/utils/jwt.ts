// src/utils/jwt.ts
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}
const JWT_EXPIRES_IN = "7d"; // Token valido per 7 giorni

export interface JwtPayload {
  userId: number;
  username: string;
}

export const generateToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
};

export const verifyToken = (token: string): JwtPayload | null => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !Number.isInteger(decoded.userId) ||
      decoded.userId < 1 ||
      typeof decoded.username !== "string" ||
      decoded.username.length === 0
    ) {
      return null;
    }
    return { userId: decoded.userId, username: decoded.username };
  } catch {
    return null;
  }
};
