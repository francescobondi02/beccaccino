# Controllers

## Overview

Express request handlers that adapt HTTP to one service or game operation:
read the authenticated identity, parse input, call the operation, and return
JSON. Controllers do not map errors themselves; thrown `ClientError`s and other
failures propagate to `../http/errorHandler.ts`. The annotation controller is
the exception that also owns its Prisma reads and writes.

## Interface

Route bindings are defined in [`../routes/README.md`](../routes/README.md).

- `authController.ts`: `register` (201, sets cookie), `login` (sets cookie),
  `nativeLogin` (returns `{ user, token }` with `Cache-Control: no-store`, no
  cookie), `logout` (clears cookie).
- `accountController.ts`: `getCurrentUser`, `updateCurrentUser` (re-issues the
  auth cookie with the new username), `deleteCurrentUser` (clears cookie).
- `statisticsController.ts`: `getUserStats`, `getLeaderboard`.
- `roomQueryController.ts`: `getAvailableRooms`, `getRoomByCode`.
- `roomMutationController.ts`: `createRoom` (201), `createPracticeRoom` (201),
  `joinRoom`, `chooseTeam`, `setPlayerReady`, `setRoomBots`, `leaveRoom`,
  `resumePlayerControl`, `pausePracticeRoom`, `resumePracticeRoom`.
- `gameController.ts`: `chooseBriscola`, `handlePlayCard`, `getPlayableCards`,
  `getGameState`.
- `annotationController.ts`: `getAnnotationStatus`, `grantAnnotationAccess`,
  `getNextAnnotation`, `upsertAnnotationResponse`.

## Invariants

- Every handler except `register`, `login`, `nativeLogin`, `logout`, and
  `getLeaderboard` takes the identity from `requireUser(req)` (401 when
  missing); client-supplied user or player ids are never trusted.
- `chooseBriscola` derives `playerId` from `(gameRoomId, userId)` and returns
  403 when the user is not in the room (`gameController.ts:chooseBriscola`).
- `getPlayableCards` checks room access with `getRoomForUser` before reading
  legal cards (`gameController.ts:getPlayableCards`).
- `leaveRoom` treats `onlyIfWaiting` as true only for the boolean `true`
  (`roomMutationController.ts:leaveRoom`).
- `grantAnnotationAccess` returns 503 when `ANNOTATION_ACCESS_CODE` is unset
  and 400 for a wrong code; the code is compared via SHA-256 digests with
  `timingSafeEqual`. Granting is idempotent: an already-granted live account
  still succeeds (`annotationController.ts:accessCodeMatches`,
  `grantAnnotationAccess`).
- `upsertAnnotationResponse` requires a positive integer `scenarioId`, a
  string `scenarioHash` equal to the stored `stateHash` (else 409 "Scenario
  identity is stale"), boolean `skipped`, a valid `perceivedDifficulty`, and
  an integer `responseTimeMs` from 0 to 24 hours. Only skipped responses may
  carry a comment (trimmed, at most 500 characters, empty becomes `null`) and
  they must send `selectedAction: null`; non-skipped actions must be legal for
  the scenario. Responses are unique per `(userId, scenarioId)` and are
  upserted (`annotationController.ts:upsertAnnotationResponse`).
- `getNextAnnotation` re-validates the stored scenario state and hash before
  returning it (`annotationController.ts:getNextAnnotation`).

## Side Effects

- Sets or clears the `authToken` cookie (`../http/authCookie.ts`) in
  `register`, `login`, `updateCurrentUser`, `deleteCurrentUser`, and `logout`.
- `annotationController.ts` reads `User`, `AnnotationScenario`, and
  `ExpertAnnotation`, updates `User.expertAccessGrantedAt`, and upserts
  `ExpertAnnotation` rows.
- `gameController.ts:chooseBriscola` reads `Player`.
- All other database writes, runtime work, and Socket.IO events happen in the
  called services and transitions.

## Verification

- Run: `cd backend && npx jest tests/integration/auth.test.ts tests/integration/profile.test.ts tests/integration/rooms.test.ts tests/integration/game.test.ts tests/integration/annotations.test.ts --runInBand`
  (needs the `becca_test` PostgreSQL database)
- Run: `cd backend && npm run typecheck`
