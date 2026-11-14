# Backend — Development Guide

## Starting the Backend

Run `make dev` from the project root; see [Develop locally](../README.md#develop-locally).
An optional `backend/.env` can add variables (see `.env.example`).

Tests do not load `.env.test`. Jest runs `tests/loadTestEnv.ts` before Prisma
imports; it uses `TEST_DATABASE_URL` when supplied and otherwise selects the
guarded local `becca_test` database.

## Project Structure

```
backend/
├── src/
│   ├── index.ts            # Process entry: env, listen, background jobs, shutdown
│   ├── server.ts           # HTTP + Socket.IO factory, auth and IP admission
│   ├── app.ts              # Express app, routes, health/readiness probes
│   ├── gameConfig.ts       # Environment-backed game rules
│   ├── db.ts               # Prisma client singleton
│   ├── auth/               # Shared active-session verification
│   ├── controllers/        # HTTP adapters grouped by account, auth, stats, rooms, and games
│   ├── domain/game/        # Pure caller, turn, card, trick, and scoring rules
│   ├── game/
│   │   ├── liveGame.ts     # One-query load of a started game
│   │   ├── gameState.ts    # Side-effect-free per-viewer game state
│   │   ├── runGameAction.ts # Locked, versioned game mutations and publication
│   │   └── transitions/    # Round setup, briscola and card-play changes
│   ├── http/               # Input parsers, typed errors, and global error mapping
│   ├── practice/           # Versioned practice-match payload contract and parser
│   ├── routes/             # Visible REST API map
│   ├── runtime/            # Timers, bot execution, timeout policy, recovery, event publication
│   ├── scripts/            # Practice game export
│   ├── services/           # Room operations/queries, snapshots, account and stats
│   └── sockets/room.ts     # Socket presence and chat; room mutations remain REST-only
├── prisma/
│   └── schema.prisma       # Database schema
├── tests/
│   ├── unit/               # Pure logic tests (no DB)
│   ├── integration/        # API tests (real DB)
│   ├── helpers/
│   │   ├── database.ts     # Shared complete database reset
│   │   ├── serverHarness.ts # Shared ephemeral HTTP test server
│   │   └── gameDriver.ts   # Game setup and deterministic play helpers
│   ├── setup.ts            # Mock socket, set NODE_ENV=test
│   ├── loadTestEnv.ts      # Override DATABASE_URL for tests
│   └── teardown.ts         # Disconnect Prisma after tests
└── Dockerfile              # Production build
```

## Module Ownership and Call Flow

- Routes are the API map. Controllers parse request data, call one operation,
  and return its result. `src/http/errorHandler.ts` is the only HTTP error
  mapping and sanitization boundary.
- Every game write goes through `game/runGameAction.ts`. Under the room lock it
  loads the game once (`game/liveGame.ts`), applies the change, bumps
  `GameRoom.version` with a compare-and-set, writes `lastActivityAt` (and
  `turnStartedAt` when the turn moves or the game resumes), commits, re-arms the
  turn runtime for the new version and publishes `game_state`. A human move that
  loses a version race gets 409 with the current `state`; a timer or bot reply
  armed for an older version is dropped.
- `domain/game/` owns pure caller, seat, turn, legality, trick, and scoring
  rules. Snapshots, transitions, and bots consume those
  rules instead of reimplementing them.
- `game/gameState.ts` (`toGameState`) is a pure read. Loading
  `GET /api/games/:roomCode/state` never schedules a timer or starts a bot.
- Runtime changes finish before game events are published. Publication
  failures are logged and reported to Sentry but do not turn a committed
  request into an HTTP failure.

## Native app authentication

`POST /api/users/native/login` accepts the same username/password input as
browser login and returns `{ user, token }` with `Cache-Control: no-store`, without
setting a browser cookie. `POST /api/users/native/register` does the same for
registration: same input, validation, rate limit and error statuses as browser
registration (400 invalid input, 409 username taken), and `201 { user, token }`. REST endpoints accept `Authorization: Bearer <token>`
through the same active-account verifier used by cookies. Explicit malformed or
expired Authorization never falls back to cookies.
Browser login/registration response bodies and cookies are unchanged.

The mobile app stores the token in platform-secure storage, scoped to the backend
origin, and verifies `/api/users/me` when restoring the session. Native logout
removes the device credential; JWT lifetime remains seven days, with no new
server-side revocation or refresh scheme. Socket.IO also accepts `auth.token`
from native clients through the same active-account verifier; explicit invalid
native tokens never fall back to cookies. Use local/staging test accounts before
deploying this additive API change; no migration is required.

Game snapshots also expose `lastTrick` (round number, trick number, winner user
ID and four played cards), including the previous round's last trick while the
next round is dealing. Native card collection uses this stored winner rather
than recalculating rules.

## Database Management (Prisma)

```sh
cd backend

# Apply pending migrations
npx prisma migrate deploy

# Create a new migration after editing schema.prisma
npx prisma migrate dev --name <migration_name>

# Regenerate Prisma client
npx prisma generate

# Reset the dev database (drops all data)
npx prisma migrate reset

# Open Prisma Studio (visual DB editor)
npx prisma studio
```

Never run `prisma migrate reset` against a shared or production database. Test
setup uses `npm run db:test:prepare`, which migrates only the local `becca_test`
URL hard-coded in `package.json`.

## Testing

Tests are split into two Jest projects: **unit** (no DB) and **integration** (real DB).

### Setup (one-time)

The integration tests require a dedicated `becca_test` database. `make test`
runs this for you inside a container:

```sh
npm run db:test:prepare
```

This command refuses to run unless `NODE_ENV=test` and both Prisma URLs point
exactly to `localhost/becca_test`.

The root `./scripts/pre-push.sh` gate injects `TEST_DATABASE_URL` with a unique
schema under that same safe database. `tests/loadTestEnv.ts` honors this
override and applies the same localhost/`becca_test` safety check before any
test imports Prisma.

### Commands

```sh
cd backend

# Run all tests (unit + integration)
npm test

# Run only unit tests (no DB needed, fast)
npm run test:unit

# Run only integration tests (requires running DB)
npm run test:integration

# Include the real Python model gate (requires the AI service on port 8011)
RUN_LIVE_BOT_TESTS=true \
BOT_SERVICE_URL=http://localhost:8011 \
BOT_SERVICE_TOKEN=local-secret \
npm run test:integration -- tests/integration/botLive.test.ts
```

Practice-room creation calls the AI service's authenticated, tier-specific
`/ready` endpoint before writing any room or bot state. A sleeping Render
service can take about one minute to wake; this readiness path has a separate
75-second allowance. Once ready, every `/act` call retains the 5-second move
timeout.

Outside test mode, the process immediately sweeps practice rooms and repeats
every 10 minutes. A practice room with no activity for 30 days is retired:
an unstarted room is deleted, and a started game (paused or not) is marked
`finished` with no winner, so its history stays. Every game action refreshes
`lastActivityAt`. The sweep revalidates eligibility under the room lock.

Active practice games can be paused with `POST /api/rooms/:roomCode/pause` and
resumed with `POST /api/rooms/:roomCode/resume`. Only the human participant can
use these endpoints. Pause state survives process restarts and suppresses timer
recovery. Pause and resume each bump `version`, so a timer or bot response from
before them is dropped. Resuming starts a fresh full turn timer. Paused games
are subject to the same 30-day inactivity rule.

### Runtime Recovery

Before the HTTP server listens, `reconcileActiveRuntime()` scans started,
unfinished, unpaused rooms. Each room is locked and re-armed when it has no
timer for its current `version`. A human deadline is `turnStartedAt` plus the
turn timeout, so a restart keeps the same deadline. Failures are isolated per
room, keep `/ready` unavailable, and are retried by a non-overlapping
reconciler every 30 seconds. Game-state reads never recover runtime.

The third timeout in a row hands a multiplayer seat to a bot in the same
transaction (`takeover: true` in `lastAction`). Reconnecting does not return the
seat; the player uses `POST /api/rooms/:roomCode/resume-control`. Practice games
count timeouts but never take the seat.

### Backend and AI Contract

The TypeScript backend is authoritative for persisted online games, turn
validation, and accepted moves. The Python package owns training, simulation,
state adaptation, and model inference; its rules mirror the backend for those
workflows.

`tests/integration/botStateFixtures.test.ts` consumes
`../ai/serving/fixtures/bot_states.json` to verify the real TypeScript
serializer against Python-generated states.

### Test Architecture

| Project | Runs | DB Required | Files |
|---------|------|-------------|-------|
| `unit` | In parallel | No | `tests/unit/**/*.test.ts` |
| `integration` | In band (serial) | Yes (`becca_test`) | `tests/integration/**/*.test.ts` |

- **Unit tests** cover pure card parsing, scoring, trick rules, room-code generation, and the production chat sanitizer.
- **Integration tests** use Supertest and real Socket.IO clients against the Express/server factory with PostgreSQL. They sign in with real tokens from `generateToken` (see `tests/helpers/serverHarness.ts`).
- Each integration test calls the shared `tests/helpers/database.ts`
  `clearDatabase()` in `beforeEach` for isolation.
- Shared teardown closes HTTP servers, sockets, Prisma, and all turn timers.

## Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run dev` | Generate Prisma + migrate + start dev server with hot-reload |
| `npm run dev:e2e` | Start the backend against the isolated Playwright database |
| `npm test` | Run all Jest tests |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration tests only (serial) |
| `npm run typecheck` | Compile checks without emitting files |
| `npm run build` | Generate Prisma + compile TypeScript |
| `npm run db:test:prepare` | Apply the Prisma schema to the isolated `becca_test` database |
| `npm start` | Run compiled `dist/index.js` (production) |
| `npm run migrate` | Apply Prisma migrations |

## Practice Game Data

Practice games are normal games with bots, stored in the same tables as
multiplayer games (`isPractice = true`). Stats and the leaderboard skip them.
Training reads the game tables directly. `PlayedCard.autoPlayed` and
`Round.briscolaAutoChosen` mark moves the server chose after a timeout or a bot
service failure; exclude them from training labels.

Practice games are kept. Leaving a started practice game, starting a new one,
or the 30-day sweep marks it `finished` with `winnerTeam = null`. Only unstarted
rooms and rooms whose creation failed are deleted.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/users/register` | No | Register with username + password |
| POST | `/api/users/login` | No | Login, returns HTTP-only cookie |
| POST | `/api/users/native/register` | No | Native register, returns `{ user, token }` |
| POST | `/api/users/native/login` | No | Native login, returns `{ user, token }` |
| POST | `/api/users/logout` | Yes | Clear auth cookie |
| GET | `/api/users/me` | Yes | Get current user |
| PATCH | `/api/users/me` | Yes | Update current user |
| DELETE | `/api/users/me` | Yes | Anonymize current user |
| GET | `/api/users/me/stats` | Yes | Get player statistics |
| GET | `/api/users/leaderboard` | No | Get multiplayer leaderboard |
| POST | `/api/rooms/` | Yes | Create a new room |
| POST | `/api/rooms/practice` | Yes | Start a practice game against bots |
| GET | `/api/rooms/available` | Yes | List joinable rooms + active games |
| GET | `/api/rooms/:roomCode` | Yes | Get room details |
| POST | `/api/rooms/:roomCode/join` | Yes | Join a room by code |
| POST | `/api/rooms/:roomCode/choose-team` | Yes | Choose team 0 or 1 |
| POST | `/api/rooms/:roomCode/ready` | Yes | Toggle ready state |
| POST | `/api/rooms/:roomCode/pause` | Yes | Pause an active practice room |
| POST | `/api/rooms/:roomCode/resume` | Yes | Resume an active practice room and recover its turn |
| POST | `/api/rooms/:roomCode/leave` | Yes | Leave an open lobby; practice rooms are deleted, active multiplayer returns 409, and finished multiplayer history is preserved |
| GET | `/api/games/:roomCode/state` | Yes | Get the caller's full game state |
| POST | `/api/games/:roomCode/briscola` | Yes | Choose trump suit; returns the new state |
| POST | `/api/games/:roomCode/cards` | Yes | Play a card; returns the new state |
| GET | `/health` | No | Health check |
| GET | `/ready` | No | Database readiness check |

Team selection and ready-state changes are REST-only mutations. Socket.IO
delivers `game_state` (full per-player state), `room_changed`, `lobby_changed`,
plus presence and chat events.

## CI

GitHub Actions validates the complete Prisma migration history against a fresh
PostgreSQL database, verifies that it matches `schema.prisma`, and runs the
integration suite without the local-only `prisma db push` preparation. It also
builds and starts the production Dockerfile, so a green `Backend` workflow covers
the same migration and runtime path used by Render.

Production deploys are not automated yet.

## Troubleshooting

**Port already in use:**
```sh
lsof -i :8000
kill -9 <PID>
```

**Cannot connect to database:**
```sh
docker compose ps              # verify DB container is running
docker compose logs db         # check DB logs
docker compose restart db
```

**Prisma Client not generated:**
```sh
npx prisma generate
```

**Integration tests hitting dev database:**
Check that `tests/loadTestEnv.ts` is listed under `setupFiles` in `jest.config.js`.
