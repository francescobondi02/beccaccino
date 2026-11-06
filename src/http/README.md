# HTTP Adapters

## Overview

Express-facing helpers shared by controllers, middleware, and the app: typed
client errors, the global error handler, the authenticated request identity,
the `authToken` cookie, and (in `input/`) request-body parsers.

## Interface

- `errors.ts`
  - `ClientError(status, message, details = {})`.
  - Factories: `badRequest` (400), `unauthorized` (401, default
    "Authentication required"), `forbidden` (403), `notFound` (404),
    `conflict` (409, optional `details`), `serviceUnavailable` (503).
- `errorHandler.ts`
  - `errorHandler`: Express `ErrorRequestHandler`.
- `request.ts`
  - `requireUser(req)`: returns `req.user` (`JwtPayload`) or throws
    `unauthorized()`.
- `authCookie.ts`
  - `setAuthCookie(response, user)`: sets the `authToken` JWT cookie.
  - `clearAuthCookie(response)`: clears it with the same options.
- [`./input/README.md`](./input/README.md): room and user body parsers.

## Invariants

- `ClientError` responses use the error's status and body
  `{ error: message, ...details }` (`errorHandler.ts:errorHandler`).
- `BotServiceError` (from `../services/botClient.ts`) maps to 503
  `{ error: "Bot service unavailable" }`; every other error maps to 500
  `{ error: "Internal server error" }`, so internal messages are never
  returned to clients (`errorHandler.ts:errorHandler`).
- The auth cookie is `httpOnly`, lives 7 days, and uses `secure: true` with
  `sameSite: "none"` when `NODE_ENV === "production"`, otherwise
  `secure: false` with `sameSite: "strict"` (`authCookie.ts:COOKIE_OPTIONS`).
- The cookie token encodes `{ userId, username }` via `generateToken` from
  `../utils/jwt.ts` (`authCookie.ts:setAuthCookie`).

## Side Effects

- `errorHandler` logs `bot_service_unavailable` (warn) or `unhandled_error`
  (error) through `req.log` or the shared `logger`, and writes the response.
- `setAuthCookie` / `clearAuthCookie` write `Set-Cookie` headers.
- `errors.ts` and `request.ts`: none.

## Verification

- Run: `cd backend && npx jest tests/unit/httpErrors.test.ts tests/unit/httpInput.test.ts`
