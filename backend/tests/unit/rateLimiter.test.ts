import { Request, Response } from "express";
import {
  generalRateLimiter,
  loginRateLimiter,
  registerRateLimiter,
} from "../../src/middleware/rateLimiter";

describe("rateLimiter", () => {
  const environment = process.env.NODE_ENV;
  beforeAll(() => {
    process.env.NODE_ENV = "production";
  });
  afterAll(() => {
    process.env.NODE_ENV = environment;
  });

  const response = { setHeader: () => undefined } as unknown as Response;
  const hit = (
    limit: typeof generalRateLimiter,
    request: { ip: string; userId?: number; username?: string },
  ) => {
    const next = jest.fn();
    limit(
      {
        ip: request.ip,
        user: request.userId
          ? { userId: request.userId, username: `u${request.userId}` }
          : undefined,
        body: { username: request.username },
      } as unknown as Request,
      response,
      next,
    );
    return next.mock.calls[0][0]?.status ?? 200;
  };
  const exhaust = (
    limit: typeof generalRateLimiter,
    request: Parameters<typeof hit>[1],
    times: number,
  ) => {
    for (let i = 1; i < times; i++) hit(limit, request);
    return hit(limit, request);
  };

  it("gives each authenticated player sharing an IP their own budget", () => {
    const ip = "203.0.113.1";
    expect(exhaust(generalRateLimiter, { ip, userId: 1 }, 100)).toBe(200);
    expect(hit(generalRateLimiter, { ip, userId: 1 })).toBe(429);
    expect(hit(generalRateLimiter, { ip, userId: 2 })).toBe(200);
  });

  it("keeps per-IP limits for anonymous requests", () => {
    const ip = "203.0.113.2";
    expect(exhaust(generalRateLimiter, { ip }, 100)).toBe(200);
    expect(hit(generalRateLimiter, { ip })).toBe(429);
  });

  it("limits logins per username and IP", () => {
    const ip = "203.0.113.3";
    expect(exhaust(loginRateLimiter, { ip, username: "alice" }, 10)).toBe(200);
    expect(hit(loginRateLimiter, { ip, username: "alice" })).toBe(429);
    expect(hit(loginRateLimiter, { ip, username: "bob" })).toBe(200);
    expect(hit(loginRateLimiter, { ip: "203.0.113.4", username: "alice" })).toBe(200);
  });

  it("limits registrations per IP", () => {
    const ip = "203.0.113.5";
    expect(exhaust(registerRateLimiter, { ip, username: "a" }, 10)).toBe(200);
    expect(hit(registerRateLimiter, { ip, username: "b" })).toBe(429);
  });
});
