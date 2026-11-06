# Utilities

## Overview

Small shared helpers with no Express or Socket.IO dependency: typed game
errors, JWT signing and verification, password hashing, the injectable RNG and
room-code generator, the per-room async mutex, strict JSON field readers, chat
sanitization, username validation, ranked-game filters, and per-player game
summaries.

## Interface

- `gameError.ts`: `GameError(message, status, details?)` (extends
  `ClientError` from `../http/errors.ts`).
- `jwt.ts`: `JwtPayload` (`{ userId, username }`), `generateToken(payload)`,
  `verifyToken(token)`.
- `password.ts`: `hashPassword(password)`, `comparePassword(password, hashedPassword)`.
- `random.ts`: type `RNG`, `getRng()`, `setRng(rng)` (returns a restore
  function), `createSeededRng(seed)`.
- `generateRoomCode.ts`: `generateRoomCode(length = 6)`.
- `roomLock.ts`: `withRoomLock(key, fn)`.
- `json.ts`: type `JsonRecord`, `recordAt(value, path)`,
  `exactKeys(record, expected, path)`, `integerAt(value, path, minimum, maximum?)`.
- `sanitizeChatMessage.ts`: `sanitizeChatMessage(input)`.
- `validateUsername.ts`: `validateUsername(username)` returning
  `{ ok: true, value } | { ok: false, error }`.
- `statsFilters.ts`: `RANKED_FINISHED_GAME`, `LIVE_MULTIPLAYER_ROOM`,
  `OPEN_LOBBY` (Prisma `GameRoom` where-filters).
- `playerGameStats.ts`: type `PlayerGameSummary`,
  `summarizePlayerGame(playerTeam, rounds, players)`.

## Invariants

- Importing `jwt.ts` throws if `JWT_SECRET` is unset. Tokens expire after 7
  days; `verifyToken` returns `null` unless the payload has a positive integer
  `userId` and a non-empty `username` (`jwt.ts`).
- Passwords use bcrypt with 10 salt rounds (`password.ts`).
- All game randomness should go through `getRng()` so tests can inject a
  seeded generator; the default is `Math.random` (`random.ts`).
- Room codes use the 32-character alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
  (no `0`, `O`, `1`, `I`) (`generateRoomCode.ts`).
- `withRoomLock` runs critical sections for the same key strictly one after
  another, whether earlier ones resolve or reject; it is not reentrant, so code
  already holding a key's lock must call the `*Unlocked` variants. The lock is
  in-process only (`roomLock.ts`).
- `exactKeys` rejects missing or extra keys; `integerAt` accepts only integers
  within `[minimum, maximum]` (`json.ts`).
- Chat messages are trimmed, cut to 200 characters, stripped of control
  characters other than tab, newline, and carriage return, and become `null`
  when empty (`sanitizeChatMessage.ts`).
- Usernames are trimmed and must be 3 to 20 characters (`validateUsername.ts`).
- Ranked statistics include only finished non-practice games; live and open
  lobby filters also exclude practice rooms (`statsFilters.ts`).
- `summarizePlayerGame` sums rounds on raw values and breaks exact point ties
  in favor of the final round's caller team; it throws when the player or
  caller has no valid team (`playerGameStats.ts`).

## Side Effects

- `roomLock.ts` keeps a module-level map of lock tails.
- `random.ts` keeps a module-level RNG that `setRng` replaces.
- All other helpers are pure (bcrypt hashing is CPU work only).

## Verification

- Run: `cd backend && npx jest tests/unit/jwt.test.ts tests/unit/generateRoomCode.test.ts tests/unit/chatSanitization.test.ts tests/unit/httpErrors.test.ts`
- Run: `cd backend && npx jest tests/integration/concurrency.test.ts tests/integration/tieStatistics.test.ts --runInBand`
  (needs the `becca_test` PostgreSQL database)
