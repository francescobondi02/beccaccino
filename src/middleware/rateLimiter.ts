// src/middleware/rateLimiter.ts
/**
 * Simple in-memory rate limiter middleware.
 * Tracks requests by IP and rejects with 429 when limit is exceeded.
 * Not suitable for multi-instance deployments (use Redis-backed solution instead).
 */

import { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface RateLimiterOptions {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  message?: string; // Custom error message
}

const stores = new Map<string, Map<string, RateLimitEntry>>();

export function rateLimiter(options: RateLimiterOptions) {
  const { windowMs, maxRequests, message = "Too many requests, please try again later" } = options;

  // Each rateLimiter call gets its own store so different routes can have different limits
  const store = new Map<string, RateLimitEntry>();
  const storeId = `store_${stores.size}`;
  stores.set(storeId, store);

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
    // Skip rate limiting in test environment
    if (process.env.NODE_ENV === "test") {
      return next();
    }

    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();

    let entry = store.get(key);

    if (!entry || now > entry.resetTime) {
      // First request or window expired — reset
      entry = { count: 1, resetTime: now + windowMs };
      store.set(key, entry);
    } else {
      entry.count++;
    }

    // Set rate limit headers
    res.setHeader("X-RateLimit-Limit", maxRequests.toString());
    res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - entry.count).toString());
    res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetTime / 1000).toString());

    if (entry.count > maxRequests) {
      return res.status(429).json({ error: message });
    }

    next();
  };
}

/**
 * Pre-configured rate limiters for common use cases
 */

// Auth endpoints: 10 attempts per minute (prevent brute-force)
export const authRateLimiter = rateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  message: "Too many authentication attempts, please try again in a minute",
});

// General API: 100 requests per minute
export const generalRateLimiter = rateLimiter({
  windowMs: 60_000,
  maxRequests: 100,
  message: "Too many requests, please slow down",
});

// Game actions: 60 requests per minute (one action per second average)
export const gameRateLimiter = rateLimiter({
  windowMs: 60_000,
  maxRequests: 60,
  message: "Too many game actions, please slow down",
});
