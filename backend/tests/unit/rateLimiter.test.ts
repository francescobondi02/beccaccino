import { Request, Response } from "express";
import { rateLimiter } from "../../src/middleware/rateLimiter";

describe("rateLimiter", () => {
  const environment = process.env.NODE_ENV;
  beforeAll(() => {
    process.env.NODE_ENV = "production";
  });
  afterAll(() => {
    process.env.NODE_ENV = environment;
  });

  const response = { setHeader: () => undefined } as unknown as Response;
  const hit = (limit: ReturnType<typeof rateLimiter>, userId?: number) => {
    const next = jest.fn();
    const request = {
      ip: "203.0.113.7",
      user: userId ? { userId, username: `u${userId}` } : undefined,
    } as unknown as Request;
    limit(request, response, next);
    return next.mock.calls[0][0]?.status ?? 200;
  };

  it("gives each authenticated player sharing an IP their own budget", () => {
    const limit = rateLimiter({ windowMs: 60_000, maxRequests: 1, keyByUser: true });
    expect([hit(limit, 1), hit(limit, 2), hit(limit, 1)]).toEqual([200, 200, 429]);
  });

  it("keeps per-IP limits for anonymous and auth limiters", () => {
    const anonymous = rateLimiter({ windowMs: 60_000, maxRequests: 1, keyByUser: true });
    expect([hit(anonymous), hit(anonymous)]).toEqual([200, 429]);
    const auth = rateLimiter({ windowMs: 60_000, maxRequests: 1 });
    expect([hit(auth, 1), hit(auth, 2)]).toEqual([200, 429]);
  });
});
