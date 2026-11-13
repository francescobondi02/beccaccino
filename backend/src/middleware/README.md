# Middleware

## Overview

Express middleware applied by the route modules: authentication, expert
annotation access, in-memory rate limiting, and request validation for game
endpoints. Failures are passed to `next(error)` as `ClientError`s so the global
handler in `../http/errorHandler.ts` writes the response.

## Interface

- `auth.ts`
  - `authenticateToken`: sets `req.user` from a `Bearer` token or the
    `authToken` cookie, or (tests only) from the test-bypass headers.
  - Global augmentation: `Express.Request.user?: JwtPayload`.
- `annotationAccess.ts`
  - `requireAnnotationAccess`: requires an authenticated, non-deleted user with
    `expertAccessGrantedAt` set.
- `rateLimiter.ts`
  - `rateLimiter({ windowMs, maxRequests, message?, keyByUser? })`.
  - Presets: `authRateLimiter` (10/min per IP), `generalRateLimiter`
    (100/min, per user when authenticated), `gameRateLimiter` (60/min, per user
    when authenticated).
- `validate.ts`
  - `validateChooseBriscola`: integer `gameRoomId`, valid `suit`.
  - `validatePlayCard`: non-empty string `roomCode`, valid `suit` and `value`,
    optional `signal` in `CARD_SIGNALS` or `null`.
  - `validateGetPlayableCards`: `roomCode` path parameter present.

## Invariants

- An `Authorization` header must match `Bearer <token>` (case-insensitive);
  when it is present, the cookie and test bypass are never consulted. Missing
  or empty explicit credentials yield 401 "Invalid or expired token"
  (`auth.ts:authenticateToken`).
- Tokens are accepted only through `verifyActiveSession`
  (`../auth/activeSession.ts`), so deleted accounts are rejected.
- Cookie-authenticated mutations (methods other than GET, HEAD, OPTIONS) with
  an `Origin` header different from `FRONTEND_URL` are rejected with 403
  "Cross-site request rejected" unless `Sec-Fetch-Site` is `same-origin`.
  Bearer-authenticated requests skip this check (`auth.ts:isCrossSiteMutation`).
- Without credentials, the test bypass applies only when
  `isTestAuthBypassEnabled()` is true; then `req.user` comes from
  `testRequestIdentity` and may be `undefined`. Otherwise the request gets 401.
- `requireAnnotationAccess` returns 401 for a missing or deleted user and 403
  "Expert access required" when access was never granted.
- Rate limiters are skipped entirely when `NODE_ENV` is `test` or
  `development`. Over the limit they return a 429 `ClientError`; each limiter
  instance has its own store (`rateLimiter.ts:rateLimiter`).
- Validation messages list the allowed enum values from `../domain/game/cards.ts`.

## Side Effects

- `auth.ts` and `annotationAccess.ts` read the `User` table via Prisma and
  mutate `req.user`.
- `rateLimiter.ts` keeps per-process in-memory counters (not shared across
  instances), starts an unref'd 60-second cleanup interval per limiter, and
  sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`
  response headers.
- `validate.ts`: none.

## Verification

- Run: `cd backend && npx jest tests/unit/rateLimiter.test.ts tests/unit/jwt.test.ts`
- Run: `cd backend && npx jest tests/integration/auth.test.ts tests/integration/annotations.test.ts --runInBand`
  (needs the `becca_test` PostgreSQL database)
