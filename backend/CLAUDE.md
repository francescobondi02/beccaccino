# Backend - Express, Socket.IO, and Prisma

Node 24, TypeScript, Express 5, Prisma, and Socket.IO. See `DEVELOPMENT.md`
for setup, commands, endpoints, and operator procedures.

## Ownership

```text
src/
  index.ts                 Process entry, startup recovery, shutdown
  app.ts                   Express middleware, routes, probes, global errors
  server.ts                HTTP and Socket.IO factory and transport auth
  auth/                    Active account sessions
  http/                    Input parsing, request identity, typed HTTP errors
  controllers/             HTTP adaptation only
  routes/                  Visible REST API map
  domain/game/             Pure cards, caller, turn, trick, and scoring rules
  game/snapshots/          Persisted caller/current-turn reads
  game/transitions/        Atomic round and card-play mutations
  game/turn.ts             Shared turn phase, identity, and comparison
  runtime/                 Timers, bots, timeout policy, recovery, publication
  services/                Room operations/queries, account, stats
  practice/                Practice archive payload version, types, parser
  sockets/room.ts          Presence and chat handlers
  scripts/                 Practice JSONL export
```

Controllers parse input, call one operation, and return the result. Do not add
controller-local `try/catch` response mapping; `http/errorHandler.ts` maps typed
client errors and sanitizes unexpected failures.

Routes are the public API map. Avoid compatibility barrels that hide which
controller or service owns a route.

Use these entry points when following the game:

- `services/multiplayerRooms.ts` and `services/practiceRooms.ts`: room operations.
- `services/leaveRoom.ts`: participant departure, not ownership checks.
- `services/playableCards.ts`: read-only legal-card query.
- `services/botUsers.ts`: bot accounts and tiers; `botClient.ts`: Python HTTP calls.
- `domain/game/trickWinner.ts`, `roundScore.ts`, `gameScore.ts`: pure rules at each scope.

Use explicit `userId` and `playerId` names. `playerTeams` maps player IDs to
teams. A trick is one four-card play; a hand is the cards held by a player.
Prisma's `Hand` model and existing `hand*` API fields retain their legacy names.

## Call Flow

Room mutations:

```text
route -> room mutation controller -> multiplayer/practice/leave operation
      -> database mutation
      -> runtime recovery or cleanup
      -> best-effort Socket.IO publication
```

Game mutations:

```text
route -> game controller -> round/card-play operation
      -> database transaction
      -> runtime start or cleanup
      -> best-effort event publication
```

Each operation owns its database writes, runtime handoff, and publication.
Every game writer calls `markGameChanged` (bumps `GameRoom.version`) inside its
transaction. After commit and the runtime start or clear, it calls
`sendGameState(roomCode, lastAction)`, which emits a full `game_state` (types in
`src/contract/`) to `user:<id>` for each human still in the game. Mutation
responses return the caller's copy of the same state. Publication failure is
logged and captured but does not fail an already committed request.

`services/gameState.ts` and `game/snapshots/` are read-only. A game-state GET
must never start a timer, run a bot, or repair runtime.

Team selection and ready changes are REST-only:

- `POST /api/rooms/:roomCode/choose-team`
- `POST /api/rooms/:roomCode/ready`

Room changes emit `room_changed { roomCode }` to the room; changes that affect
the lobby list also emit `lobby_changed` to `lobby`. Clients refetch over REST.
Client-to-server room sockets are limited to lobby/room presence, leave, and
chat.

## Runtime Recovery

`index.ts` completes the initial `reconcileActiveRuntime()` pass before the HTTP
server listens. Recovery scans started, unfinished, unpaused rooms and locks
each room before deriving the persisted caller and exact turn identity. It
restores bot-seat metadata and schedules only when that turn has no scheduled
or executing runtime. `/ready` remains unavailable while any room recovery
fails, and the non-overlapping periodic reconciler retries failed or missing
runtime.

Practice resume commits `pausedAt = null` and a new pause epoch, restores bot
seats, then calls `startRuntimeTurn` directly (not the recovery path) when that
turn has no runtime, so no deal-presentation delay is added. Paused rooms are
excluded from recovery. Snapshot reads remain
side-effect free.

Runtime responsibilities are separate:

- `turnTimer.ts`: scheduled/executing turn ownership, cancellation, timer reads
- `turnRuntime.ts`: start turn runtime and clear room runtime
- `botExecutor.ts`: bot move execution
- `timeoutPolicy.ts` and `timeoutExecutor.ts`: penalties and elapsed-turn policy
- `autoPlay.ts`: fallback legal autoplay
- `recovery.ts`: explicit startup/resume restoration
- `reconciler.ts`: periodic, non-overlapping runtime repair
- `eventPublisher.ts`: best-effort Socket.IO publication

Player control survives restarts in `Player.botModel`, `timeoutCount`, and
`abandonedAt`. In multiplayer rooms, three consecutive human timeouts hand the
retained seat to a real bot; practice rooms never do, because their single human
must stay the archived player. Successful manual moves reset the count atomically. Socket rejoin or
`POST /api/rooms/:roomCode/resume-control` reclaims AFK control, never a
permanently abandoned seat. Multiplayer leave preserves player identity,
cards, history, and ranking eligibility, but removes the abandoned membership
from active-game conflicts. Control changes fence in-flight runtime moves and
rearm only the affected current turn. Recovery also completes interrupted
third-timeout handoffs. Ordinary disconnects do not remove or pause players.

The backend assumes one active runtime instance. Distributed timer ownership is
not implemented.

Round presentation timing lives in `gameConfig.ts`: 2.4 seconds for dealing,
then 1.6 seconds to read the hand, after a 4-second round summary on later
rounds (ordinary tricks still retain their 3-second collection). Deadlines derive from persisted `Round.createdAt`, including
runtime recovery. Bots wait until presentation ends before thinking about
briscola; human callers retain their full choice timeout. Game-state snapshots
expose remaining presentation time in `round.deal`; reads stay side-effect free.
`roundSummary` exposes the previous score only during that 4-second window.
`services/gameResult.ts` derives final scores, round history and player counters
from persisted rounds/tricks/cards. Both atomic game completion and finished
snapshots use it, so refresh and Socket.IO results agree. Enemy aces count for
the trick winner, not their teammate; losing one's ace is not a skill judgment.

## Backend and AI Boundary

The backend is the online source of truth: it owns persisted game state,
current-turn validation, and move acceptance. Python owns AI training,
simulation, state adaptation, and inference. Keep the implementations aligned
through shared rule vectors, the Python-generated bot fixture consumed by the
backend integration suite, and the runtime legal-card agreement check.

The cross-language fixture test reads the fixture from the sibling `ai/`
folder.

## Database Operations

Schema and migrations live under `prisma/`.

```bash
npx prisma migrate deploy
npx prisma generate
npm run db:test:prepare
```

`db:test:prepare` runs `prisma migrate deploy` with `NODE_ENV=test` against the
local `becca_test` URL hard-coded in `package.json`; it never targets another
host or database and does not reset data. Integration
tests use the shared reset in `tests/helpers/database.ts`.

Practice retirement archives and deletes in one transaction. Runtime state is
cleared only after successful deletion, so archive/delete failure leaves both
the room and runtime available for retry. The versioned JSON payload contract
is in `practice/matchPayload.ts` and is shared by archive creation and export.

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
