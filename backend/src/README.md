# Backend Source

## Overview

TypeScript source for the Beccaccino backend: an Express 5 REST API and a
Socket.IO server sharing one HTTP server, backed by PostgreSQL through Prisma.
Direct files wire the process together (entry point, Express app, server
factory, Prisma client, logger, socket singleton, and game timing config);
subdirectories hold routes, controllers, services, game rules and
transitions, runtime timers and bots, sockets, annotations, practice archive
contracts, and operator scripts.

## Interface

- `index.ts` (process entry, `npm run dev` / `node dist/index.js`): validates
  required env vars, creates the server, runs startup recovery, starts
  background jobs, listens on `PORT` (default 8000), and handles shutdown.
- `app.ts`: default export `app` (Express application). Mounts
  `/api/users`, `/api/rooms`, `/api/games`, `/api/annotations`; serves
  `GET /health`, `GET /version`, `GET /ready`; serves static files from
  `<cwd>/public` with an `index.html` fallback for non-API GET navigations;
  installs `errorHandler` last.
- `server.ts`: types `CreateServerOptions` (`allowTestAuthBypass`,
  `corsOrigin`, `maxSocketsPerIp`) and `CreatedServer`
  (`{ httpServer, io, close }`); `createServer(options = {})`.
- `db.ts`: `prisma` (shared `PrismaClient`).
- `logger.ts`: `logger` (pino).
- `socketInstance.ts`: `setSocketInstance(io)`, `getSocketInstance()`.
- `gameConfig.ts`: `TRICK_DISPLAY_MS` (3000), `roundDealPresentation(round, now?)`
  (`{ remainingMs, animationMs, reviewMs }`), `GAME_WIN_POINTS`.
- Subdirectories:
  - [./routes/README.md](./routes/README.md): REST API map.
  - [./controllers/README.md](./controllers/README.md): HTTP handlers.
  - [./middleware/README.md](./middleware/README.md): auth, annotation
    access, rate limits, validation.
  - [./http/README.md](./http/README.md): typed errors, error handler,
    request identity, auth cookie, input parsers.
  - [./auth/README.md](./auth/README.md): active-session and test-bypass
    identity.
  - [./services/README.md](./services/README.md): rooms, accounts, game
    state, statistics, bot client, practice archive.
  - [./domain/README.md](./domain/README.md): public player select and pure
    game rules.
  - [./game/README.md](./game/README.md): turn identity, snapshots, atomic
    transitions.
  - [./runtime/README.md](./runtime/README.md): timers, bots, timeouts,
    recovery, event publication.
  - [./sockets/README.md](./sockets/README.md): presence and chat handlers.
  - [./annotations/README.md](./annotations/README.md): expert annotation
    contracts and parsers.
  - [./practice/README.md](./practice/README.md): practice archive payload
    contract.
  - [./scripts/README.md](./scripts/README.md): annotation operator and
    practice export CLIs.
  - [./utils/README.md](./utils/README.md): shared helpers.

## Invariants

- The process exits at startup if `DATABASE_URL`, `JWT_SECRET`, or
  `FRONTEND_URL` is missing (`index.ts`).
- Outside `NODE_ENV=test`, `index.ts:start` awaits `reconcileActiveRuntime()`,
  then starts the runtime reconciler, metrics, and the practice room sweeper,
  all before `httpServer.listen`.
- `/ready` returns 503 while runtime recovery is incomplete or the database
  does not answer `SELECT 1`; `/health` always returns 200 (`app.ts`).
- Socket.IO connections must authenticate with `handshake.auth.token` or the
  `authToken` cookie through `verifyActiveSession`, unless the test bypass is
  enabled. Connections are limited per verified user (or per address when
  unauthenticated) to `MAX_SOCKETS_PER_IP` (default 10) (`server.ts:createServer`).
- Socket.IO uses path `/socket.io/`, CORS origin `FRONTEND_URL` with
  credentials, and a 10,240-byte max HTTP buffer (`server.ts`).
- `GET /version` returns `{ service: "backend", commit }`, with `commit` from
  `RENDER_GIT_COMMIT`, then `GIT_COMMIT_SHA`, else `"unknown"` (`app.ts`).
- Express installs `helmet()` and CORS with origin `FRONTEND_URL` and
  credentials (`app.ts`).
- Express trusts exactly one proxy hop outside tests; in tests it disables
  keep-alive (`app.ts`).
- `getSocketInstance()` throws until `createServer` has registered the server
  (`socketInstance.ts`).
- `GAME_WIN_POINTS` comes from `GAME_WIN_POINTS` (default 41; invalid values
  fall back to 41). Round presentation is 2.4 s deal + 1.6 s review, plus a
  4 s summary for rounds after the first, measured from `Round.createdAt`
  (`gameConfig.ts`).
- The logger is silent in tests unless `LOG_LEVEL` is set, and redacts
  cookies, authorization headers, passwords, and tokens (`logger.ts`).
- The backend assumes a single process: timers, bot seats, locks, and rate
  limits are in memory.

## Side Effects

- Loads `.env` into `process.env` with `process.loadEnvFile()` when the file
  exists; already-set variables are not overridden (`index.ts`).
- Listens on an HTTP port and accepts WebSocket connections.
- Connects to PostgreSQL through Prisma; disconnects on shutdown.
- Registers `SIGTERM`/`SIGINT`, `unhandledRejection`, and `uncaughtException`
  handlers; exits the process on fatal errors (`index.ts`).
- Writes structured JSON logs (pretty-printed via `pino-pretty` outside
  production) and request logs with an `x-request-id` header (`app.ts`,
  `logger.ts`).
- Reads files from `<cwd>/public` for static serving.

## Verification

- Run: `cd backend && npm run typecheck`
- Run: `cd backend && npm run test:unit`
- Run: `cd backend && npm run db:test:prepare && npm run test:integration`
  (needs the local `becca_test` PostgreSQL database)
