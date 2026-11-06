# Authentication Helpers

## Overview

Shared identity resolution for HTTP middleware and Socket.IO transport
authentication: verifying that a JWT belongs to an active (not deleted)
account, extracting the `authToken` cookie from a raw `Cookie` header, and the
test-only header identity bypass.

## Interface

- `activeSession.ts`
  - `verifyActiveSession(token)`: `Promise<JwtPayload | null>`; returns the
    current database `{ userId, username }` for a valid token whose user
    exists and has `deletedAt: null`.
  - `authTokenFromCookieHeader(cookieHeader)`: URI-decoded `authToken` cookie
    value, or `null`.
- `testAuthBypass.ts`
  - `isTestAuthBypassEnabled(explicit?)`: whether the header identity bypass
    is enabled.
  - `testRequestIdentity(headers)`: `JwtPayload` from `x-test-user-id` and
    `x-test-username`, or `null`.
- `JwtPayload` and `verifyToken` come from `../utils/jwt.ts`.

## Invariants

- A token is accepted only if `verifyToken` succeeds and the user row still
  exists with `deletedAt: null`; the returned username is read from the
  database, not from the token (`activeSession.ts:verifyActiveSession`).
- An empty `authToken` cookie value yields `null`
  (`activeSession.ts:authTokenFromCookieHeader`).
- The bypass is enabled only when `NODE_ENV === "test"` and either the
  `explicit` argument is `true` or, when it is omitted,
  `ALLOW_TEST_AUTH_BYPASS === "true"` (`testAuthBypass.ts:isTestAuthBypassEnabled`).
- The bypass identity requires both headers: a positive integer
  `x-test-user-id` and a non-empty `x-test-username`
  (`testAuthBypass.ts:testRequestIdentity`).

## Side Effects

- `verifyActiveSession` reads the `User` table through the shared Prisma
  client (`../db.ts`). The other functions are pure.

## Verification

- Run: `cd backend && npx jest tests/unit/jwt.test.ts`
- Run: `cd backend && npx jest tests/integration/auth.test.ts tests/integration/socket.test.ts --runInBand`
  (needs the `becca_test` PostgreSQL database)
