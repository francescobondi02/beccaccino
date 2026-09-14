# Backend - Express, Socket.IO, and Prisma

Node 24, TypeScript, Express 5, Prisma, and Socket.IO. See `DEVELOPMENT.md`
for setup, commands, endpoints, and operator procedures.

## Ownership

```text
src/
  index.ts                 Process entry, startup recovery, shutdown
  app.ts                   Express middleware, routes, probes, global errors
  server.ts                HTTP and Socket.IO factory and transport auth
  auth/                    Active account sessions and isolated test bypass
  http/                    Input parsing, request identity, typed HTTP errors
  controllers/             HTTP adaptation only
  routes/                  Visible REST API map
  domain/game/             Pure cards, caller, turn, trick, and scoring rules
  game/snapshots/          Persisted caller/current-turn reads
  game/transitions/        Atomic round and card-play mutations
  runtime/                 Timers, bots, timeout policy, recovery, publication
  services/                Coordinators, room commands/queries, account, stats
  annotations/             Contracts, state/action/batch parsing, response codec
  practice/                Practice archive payload version, types, parser
  sockets/room.ts          Presence and chat handlers
  scripts/                 Annotation operators and JSONL exports
```

Controllers parse input, call one operation, and return the result. Do not add
controller-local `try/catch` response mapping; `http/errorHandler.ts` maps typed
client errors and sanitizes unexpected failures.

Routes are the public API map. Avoid compatibility barrels that hide which
controller or service owns a route.

## Call Flow

Room mutations:

```text
route -> room mutation controller -> roomCoordinator
      -> multiplayer/practice command transaction
      -> runtime recovery or cleanup
      -> best-effort Socket.IO publication
```

Game mutations:

```text
route -> game controller -> turnCoordinator
      -> round/card-play transition transaction
      -> runtime directive
      -> best-effort event publication
```

Transitions do not schedule timers or publish events. They commit database
changes and return an outcome containing the result, runtime directive, and
events. `coordinateOutcome()` applies runtime before publication. Publication
failure is logged and captured but does not fail an already committed request.

`services/gameState.ts` and `game/snapshots/` are read-only. A game-state GET
must never start a timer, run a bot, or repair runtime.

Team selection and ready changes are REST-only:

- `POST /api/rooms/:roomCode/choose-team`
- `POST /api/rooms/:roomCode/ready`

Socket.IO emits the resulting `team_chosen`, `ready_changed`, and
`game_started` events. Client-to-server room sockets are limited to lobby/room
presence, leave, and chat.

## Runtime Recovery

`index.ts` completes the initial `reconcileActiveRuntime()` pass before the HTTP
server listens. Recovery scans started, unfinished, unpaused rooms and locks
each room before deriving the persisted caller and exact turn identity. It
restores bot-seat metadata and schedules only when that turn has no scheduled
or executing runtime. `/ready` remains unavailable while any room recovery
fails, and the non-overlapping periodic reconciler retries failed or missing
runtime.

Practice resume commits `pausedAt = null` and a new pause epoch before calling
the same recovery path for that room. It returns success only after current
runtime exists. Paused rooms are excluded from recovery. Snapshot reads remain
side-effect free.

Runtime responsibilities are separate:

- `turnTimer.ts`: scheduled/executing turn ownership, cancellation, timer reads
- `turnRuntime.ts`: apply schedule/clear directives
- `botExecutor.ts`: bot move execution
- `timeoutPolicy.ts` and `timeoutExecutor.ts`: penalties and elapsed-turn policy
- `autoPlay.ts`: fallback legal autoplay
- `recovery.ts`: explicit startup/resume restoration
- `reconciler.ts`: periodic, non-overlapping runtime repair
- `eventPublisher.ts`: best-effort Socket.IO publication

The backend assumes one active runtime instance. Distributed timer ownership is
not implemented.

## Backend and AI Boundary

The backend is the online source of truth: it owns persisted game state,
current-turn validation, and move acceptance. Python owns AI training,
simulation, state adaptation, and inference. Keep the implementations aligned
through shared rule vectors, the Python-generated bot fixture consumed by the
backend integration suite, and the runtime legal-card agreement check.

The cross-language fixture test needs the full parent checkout because the
fixture lives in the sibling `ai/` submodule. A standalone backend checkout
skips that suite with an explicit message.

## Database Operations

Schema and migrations live under `prisma/`.

```bash
npx prisma migrate deploy
npx prisma generate
npm run db:test:prepare
```

`db:test:prepare` is destructive only to the local `becca_test` database and
refuses non-test mode, non-local hosts, or another database name. Integration
tests use the shared reset in `tests/helpers/database.ts`.

Practice retirement archives and deletes in one transaction. Runtime state is
cleared only after successful deletion, so archive/delete failure leaves both
the room and runtime available for retry. The versioned JSON payload contract
is in `practice/matchPayload.ts` and is shared by archive creation and export.

## Annotation Tooling

Annotation contracts are split by responsibility:

- `annotations/contracts.ts`: scenario and action types
- `annotations/state.ts`: scenario state parsing and hashing
- `annotations/action.ts`: selected-action parsing and legality
- `annotations/batch.ts`: batch metadata and duplicate validation
- `annotations/responseCodec.ts`: action/database-column conversion

The database operator is also split:

- `annotationDatabaseCli.ts`: command-line parsing
- `annotationEnvironment.ts`: protected env-file loading and target checks
- `annotationDatabaseStatus.ts`: read-only catalog/response status query
- `atomicAnnotationExport.ts`: mode-600, no-overwrite atomic export
- `annotationDatabase.ts`: import plan confirmation and orchestration

Use the wrappers documented in `scripts/annotations/README.md`. Imports and
active-catalog restores are dry run by default; apply requires the exact plan
token. Restore changes only retained rows' `active` flags and never deletes
scenarios or responses. Do not pass database credentials on the command line or
store them in the repository.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

Jest has unit and integration projects. Integration tests run serially against
PostgreSQL and use:

- `tests/helpers/database.ts` for complete resets
- `tests/helpers/serverHarness.ts` for the shared ephemeral HTTP server
- `tests/helpers/gameDriver.ts` for deterministic game setup and play

Test servers and sockets must be closed by teardown; do not leave background
dev servers or listeners running after a test command.
