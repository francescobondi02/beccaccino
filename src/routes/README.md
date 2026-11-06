# REST Routes

## Overview

The public REST API map. Each module creates an Express `Router` (default
export) that binds paths to middleware and controllers. `../app.ts` mounts them
under `/api/users`, `/api/rooms`, `/api/games`, and `/api/annotations`.

## Interface

- `users.ts` (mounted at `/api/users`)
  - `POST /register` (`authRateLimiter`) -> `register`
  - `POST /login` (`authRateLimiter`) -> `login`
  - `POST /native/login` (`authRateLimiter`) -> `nativeLogin`
  - `POST /logout` -> `logout` (no authentication)
  - `GET /me` (`authenticateToken`) -> `getCurrentUser`
  - `GET /me/stats` (`authenticateToken`) -> `getUserStats`
  - `PATCH /me` (`authenticateToken`) -> `updateCurrentUser`
  - `DELETE /me` (`authenticateToken`) -> `deleteCurrentUser`
  - `GET /leaderboard` (`generalRateLimiter`, public) -> `getLeaderboard`
- `rooms.ts` (mounted at `/api/rooms`; every route uses `authenticateToken` and
  `generalRateLimiter`)
  - `POST /` -> `createRoom`
  - `POST /practice` -> `createPracticeRoom`
  - `GET /available` -> `getAvailableRooms`
  - `GET /:roomCode` -> `getRoomByCode`
  - `POST /:roomCode/choose-team` -> `chooseTeam`
  - `POST /join` -> `joinRoom`
  - `POST /:roomCode/ready` -> `setPlayerReady`
  - `POST /:roomCode/bots` -> `setRoomBots`
  - `POST /:roomCode/pause` -> `pausePracticeRoom`
  - `POST /:roomCode/resume` -> `resumePracticeRoom`
  - `POST /:roomCode/leave` -> `leaveRoom`
  - `POST /:roomCode/resume-control` -> `resumePlayerControl`
- `games.ts` (mounted at `/api/games`; every route uses `authenticateToken` and
  `gameRateLimiter`)
  - `POST /choose-briscola` (`validateChooseBriscola`) -> `chooseBriscola`
  - `POST /play-card` (`validatePlayCard`) -> `handlePlayCard`
  - `GET /playable-cards/:roomCode` (`validateGetPlayableCards`) -> `getPlayableCards`
  - `GET /:roomCode/state` -> `getGameState`
- `annotations.ts` (mounted at `/api/annotations`; `authenticateToken` for all
  routes)
  - `GET /status` (`generalRateLimiter`) -> `getAnnotationStatus`
  - `POST /access` (`authRateLimiter`) -> `grantAnnotationAccess`
  - `GET /next` (`requireAnnotationAccess`, `generalRateLimiter`) -> `getNextAnnotation`
  - `POST /responses` (`requireAnnotationAccess`, `generalRateLimiter`) -> `upsertAnnotationResponse`

Handlers live in [`../controllers/README.md`](../controllers/README.md);
middleware in [`../middleware/README.md`](../middleware/README.md).

## Invariants

- `/api/users` registration and login routes are unauthenticated and limited by
  `authRateLimiter`; `/logout` always clears the cookie, even without a valid
  session (`users.ts`).
- `/api/annotations/next` and `/responses` are registered after
  `router.use(requireAnnotationAccess)`, so they require granted expert access;
  `/status` and `/access` do not (`annotations.ts`).
- In `rooms.ts`, `POST /join` is registered after the `/:roomCode/...` routes
  but does not conflict with them because those patterns need a second path
  segment.
- Team choice and ready state are REST mutations
  (`POST /:roomCode/choose-team`, `POST /:roomCode/ready`).

## Side Effects

- None at module load beyond creating `Router` instances; request-time effects
  belong to the bound middleware and controllers.

## Verification

- Run: `cd backend && npx jest tests/integration/rooms.test.ts tests/integration/game.test.ts tests/integration/auth.test.ts tests/integration/annotations.test.ts --runInBand`
  (needs the `becca_test` PostgreSQL database)
