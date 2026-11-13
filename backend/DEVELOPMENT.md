# Backend — Development Guide

## Prerequisites

- **Node.js** 24+ (matches Dockerfile)
- **Finch** (for the local PostgreSQL database)
- The database runs via Finch Compose from the project root

## Environment Setup

```sh
cp .env.example .env
# Edit .env to set a real JWT_SECRET
```

The database defaults work with Finch Compose out of the box. Replace
`JWT_SECRET` before sharing the server.

Tests do not load `.env.test`. Jest runs `tests/loadTestEnv.ts` before Prisma
imports; it uses `TEST_DATABASE_URL` when supplied and otherwise selects the
guarded local `becca_test` database. Initialize that database with
`npm run db:test:prepare` before running integration tests.

## Starting the Backend

### Option A: With Finch Compose (recommended for development)

From the **project root**:

```sh
finch compose up
```

This starts PostgreSQL + Adminer + the backend with hot-reload. The backend runs at `http://localhost:8000`.

### Option B: Standalone (DB must be running)

```sh
cd backend
npm ci
npx prisma generate
npx prisma migrate deploy
npm run dev
```

## Project Structure

```
backend/
├── src/
│   ├── index.ts            # Process entry: env, listen, background jobs, shutdown
│   ├── server.ts           # HTTP + Socket.IO factory, auth and IP admission
│   ├── app.ts              # Express app, routes, health/readiness probes
│   ├── gameConfig.ts       # Environment-backed game rules
│   ├── db.ts               # Prisma client singleton
│   ├── auth/               # Shared active-session verification and isolated test bypass
│   ├── controllers/        # HTTP adapters grouped by account, auth, stats, rooms, and games
│   ├── domain/game/        # Pure caller, turn, card, trick, and scoring rules
│   ├── game/
│   │   ├── snapshots/      # Side-effect-free persisted turn reads
│   │   ├── transitions/    # Atomic round and card-play database mutations
│   │   └── turn.ts         # Shared turn phase, persisted identity and comparison
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
- Room operations and `game/transitions/` own writes, runtime changes, and
  best-effort event publication. Game transactions commit before starting or
  clearing runtime; there is no intermediate coordinator or directive layer.
- `domain/game/` owns pure caller, seat, turn, legality, trick, and scoring
  rules. Snapshots, transitions, bots, and archives consume those
  rules instead of reimplementing them.
- `game/snapshots/` and `services/gameState.ts` are reads. Loading
  `GET /api/games/:roomCode/state` never schedules a timer or starts a bot.
- Runtime changes finish before game events are published. Publication
  failures are logged and reported to Sentry but do not turn a committed
  request into an HTTP failure.

## Native app authentication

`POST /api/users/native/login` accepts the same username/password input as
browser login and returns `{ user, token }` with `Cache-Control: no-store`, without
setting a browser cookie. REST endpoints accept `Authorization: Bearer <token>`
through the same active-account verifier used by cookies. Explicit malformed or
expired Authorization never falls back to cookies or the test bypass.
Browser login/registration response bodies and cookies are unchanged.

The mobile app stores the token in platform-secure storage, scoped to the backend
origin, and verifies `/api/users/me` when restoring the session. Native logout
removes the device credential; JWT lifetime remains seven days, with no new
server-side revocation or refresh scheme. Socket.IO also accepts `auth.token`
from native clients through the same active-account verifier; explicit invalid
native tokens never fall back to cookies. Use local/staging test accounts before
deploying this additive API change; no migration is required.

Game snapshots also expose `lastCompletedTrick` (round ID, hand number, winner
user ID and four played cards), including the previous round's last trick while
the next round is dealing. Existing `lastHandCards` remains current-round only.
Native card collection uses this persisted winner rather than recalculating rules.

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

The integration tests require a dedicated `becca_test` database:

```sh
# Make sure Finch Compose is running the PostgreSQL service
finch compose up -d db

cd backend
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

Outside test mode, the process immediately sweeps disposable practice rooms and
repeats every 10 minutes. The sweep removes only practice rooms that are
finished or inactive for at least 24 hours. Successful briscola choices and card
plays refresh the activity timestamp transactionally. The sweep serializes with
live room activity, revalidates eligibility under the room lock, and deletes
game rows while retaining the reusable bot `User` accounts.

Active practice games can be paused with `POST /api/rooms/:roomCode/pause` and
resumed with `POST /api/rooms/:roomCode/resume`. Only the human participant can
use these endpoints. Pause state survives process restarts, suppresses timer
recovery, and fences bot responses that started before a pause/resume cycle.
Resuming starts a fresh full turn timer. Paused rooms remain subject to the same
24-hour inactivity cleanup.

### Runtime Recovery

Before the HTTP server listens, `reconcileActiveRuntime()` scans started,
unfinished, unpaused rooms. Each room is locked, its persisted caller and exact
turn identity are read, bot seats are restored, and turn runtime starts only
when that turn has no scheduled or executing owner. Failures are
isolated per room, keep `/ready` unavailable, and are retried by a
non-overlapping periodic reconciler. Practice resume commits the unpause first
and returns success only after the same recovery path confirms current runtime.
Game-state reads never recover runtime, so repeated snapshots cannot create
timers or bot moves.

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
- **Integration tests** use Supertest and real Socket.IO clients against the Express/server factory with PostgreSQL. Auth bypass is available only when explicitly enabled in test mode.
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
| `npm run practice:export` | Emit archived practice games as JSONL, one game per line |

## Practice Game Data

Practice games are training data. A practice room is deleted as soon as the
human leaves it, and the sweeper deletes finished or day-old ones, so
`retirePracticeRoom` snapshots the game into one `PracticeMatch` row on its way
out, in the same transaction, so a failed snapshot keeps the game and runtime
for the next attempt instead of losing either.

A valid game with no genuine human action is intentionally retired without an
archive. Malformed player or round state is different: snapshot construction or
payload validation throws, rolling back both the archive and live-row deletion
while leaving runtime available for retry.

The row holds the cards each seat was dealt plus every card played in order,
which is enough to rebuild the complete game. Bot cards remain in that history
because they define the situation the human answered; they are context, not
training labels.

Each round also contains `humanActions`. This is the only training-label list.
It contains a briscola or card choice only when the acting seat is the human and
the server did not choose for them. `PlayedCard.autoPlayed` and
`Round.briscolaAutoChosen` are checked while building this list. `true` means
the server chose after a timeout or fallback, while `null` means the action
predates provenance tracking; both are excluded.

Storage is a non-issue and needs no tuning. A full 8-round game is about 20 KB
of JSON, but Postgres compresses JSONB values over ~2 KB automatically — the
measured on-disk size is **1.4 KB per game**, so 10,000 games is ~14 MB. App-side
gzip, shorter card codes, and dropping the redundant deal together save under
500 bytes per game; none of it is worth the opacity.

Practice archives contain no account ID, username, email, or pseudonym. The
human is identified only by `humanSeat`, which is enough to distinguish their
choices from the three bot seats.

```sh
npm run practice:export > practice_matches.jsonl
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/users/register` | No | Register with username + password |
| POST | `/api/users/login` | No | Login, returns HTTP-only cookie |
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
| POST | `/api/rooms/join` | Yes | Join a room by code |
| POST | `/api/rooms/:roomCode/choose-team` | Yes | Choose team 0 or 1 |
| POST | `/api/rooms/:roomCode/ready` | Yes | Toggle ready state |
| POST | `/api/rooms/:roomCode/pause` | Yes | Pause an active practice room |
| POST | `/api/rooms/:roomCode/resume` | Yes | Resume an active practice room and recover its turn |
| POST | `/api/rooms/:roomCode/leave` | Yes | Leave an open lobby; practice rooms are deleted, active multiplayer returns 409, and finished multiplayer history is preserved |
| POST | `/api/games/choose-briscola` | Yes | Choose trump suit |
| POST | `/api/games/play-card` | Yes | Play a card |
| GET | `/api/games/playable-cards/:roomCode` | Yes | Get legal cards for current turn |
| GET | `/api/games/:roomCode/state` | Yes | Get full game state |
| GET | `/health` | No | Health check |
| GET | `/version` | No | Get the deployed backend commit |
| GET | `/ready` | No | Database readiness check |

Team selection and ready-state changes are REST-only mutations. Socket.IO
continues to deliver `team_chosen`, `ready_changed`, and `game_started` events,
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
finch compose ps              # verify DB container is running
finch compose logs db         # check DB logs
finch compose restart db
```

**Prisma Client not generated:**
```sh
npx prisma generate
```

**Integration tests hitting dev database:**
Check that `tests/loadTestEnv.ts` is listed under `setupFiles` in `jest.config.js`.
