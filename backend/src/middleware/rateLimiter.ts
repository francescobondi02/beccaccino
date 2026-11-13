// src/middleware/rateLimiter.ts
/**
 * Simple in-memory rate limiter middleware.
 * Tracks requests by a key (client IP by default) and rejects with 429 when
 * the limit is exceeded.
 * Not suitable for multi-instance deployments (use Redis-backed solution instead).
 */

import { Request, Response, NextFunction } from "express";
import { ClientError } from "../http/errors";
import { USERNAME_MAX_LENGTH } from "../utils/validateUsername";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface RateLimiterOptions {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  message?: string; // Custom error message
  key?: (req: Request) => string;
}

const clientIp = (req: Request) => req.ip || req.socket.remoteAddress || "unknown";

// Players sharing one Wi-Fi get separate budgets.
const userOrIp = (req: Request) =>
  req.user ? `user:${req.user.userId}` : clientIp(req);

// Behind the Vercel proxy many players can share an IP, so a failed login
// burst only blocks that username from that IP.
const usernameAndIp = (req: Request) => {
  const username: unknown = req.body?.username;
  const name = typeof username === "string"
    ? username.trim().slice(0, USERNAME_MAX_LENGTH)
    : "invalid";
  return `${name}@${clientIp(req)}`;
};

export function rateLimiter(options: RateLimiterOptions) {
  const {
    windowMs,
    maxRequests,
    message = "Too many requests, please try again later",
    key = clientIp,
  } = options;

  // Each rateLimiter call gets its own store so different routes can have different limits
  const store = new Map<string, RateLimitEntry>();

  // Cleanup old entries periodically (every 60s) to prevent memory leaks
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (now > entry.resetTime) {
        store.delete(key);
      }
    }
  }, 60_000);

  // Don't block process from exiting
  cleanupInterval.unref();

  return (req: Request, res: Response, next: NextFunction) => {
    // Skip rate limiting in test and development environments
    if (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") {
      return next();
    }

    const now = Date.now();
    const requestKey = key(req);

    let entry = store.get(requestKey);

    if (!entry || now > entry.resetTime) {
      // First request or window expired — reset
      entry = { count: 1, resetTime: now + windowMs };
      store.set(requestKey, entry);
    } else {
      entry.count++;
    }

    // Set rate limit headers
    res.setHeader("X-RateLimit-Limit", maxRequests.toString());
    res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - entry.count).toString());
    res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetTime / 1000).toString());

    if (entry.count > maxRequests) {
      return next(new ClientError(429, message));
    }

    next();
  };
}

/**
 * Pre-configured rate limiters for common use cases
 */

// Auth endpoints: 10 attempts per minute (prevent brute-force)
const authLimit = {
  windowMs: 60_000,
  maxRequests: 10,
  message: "Too many authentication attempts, please try again in a minute",
};

export const registerRateLimiter = rateLimiter(authLimit);

// Stops one IP from cycling through many usernames.
export const loginIpRateLimiter = rateLimiter({ ...authLimit, maxRequests: 60 });

export const loginRateLimiter = rateLimiter({ ...authLimit, key: usernameAndIp });

// General API: 100 requests per minute
export const generalRateLimiter = rateLimiter({
  windowMs: 60_000,
  maxRequests: 100,
  message: "Too many requests, please slow down",
  key: userOrIp,
});

// Game actions: 60 requests per minute (one action per second average)
export const gameRateLimiter = rateLimiter({
  windowMs: 60_000,
  maxRequests: 60,
  message: "Too many game actions, please slow down",
  key: userOrIp,
});
