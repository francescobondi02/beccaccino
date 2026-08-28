# Backend — Development Guide

## Prerequisites

- **Node.js** 24+ (matches Dockerfile)
- **Finch** (for the local PostgreSQL database)
- The database runs via Finch Compose from the project root

## Environment Setup

```sh
cp .env.example .env
# Edit .env to set a real JWT_SECRET and private ANNOTATION_ACCESS_CODE
```

The database defaults work with Finch Compose out of the box. Replace both
`JWT_SECRET` and `ANNOTATION_ACCESS_CODE` before sharing the annotation page.

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
│   ├── annotations/        # Scenario contracts, parsers, legality, selection, response codec
│   ├── auth/               # Shared active-session verification and isolated test bypass
│   ├── controllers/        # HTTP adapters grouped by account, auth, stats, rooms, and games
│   ├── domain/game/        # Pure caller, turn, card, trick, and scoring rules
│   ├── game/
│   │   ├── snapshots/      # Side-effect-free persisted turn reads
│   │   └── transitions/    # Atomic round and card-play database mutations
│   ├── http/               # Input parsers, typed errors, and global error mapping
│   ├── practice/           # Versioned practice-match payload contract and parser
│   ├── routes/             # Visible REST API map
│   ├── runtime/            # Timers, bot execution, timeout policy, recovery, event publication
│   ├── scripts/            # Annotation operators and practice/annotation exports
│   ├── services/           # Coordinators, room commands/queries, snapshots, account and stats
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
- `roomCoordinator.ts` and `turnCoordinator.ts` sequence committed database
  work, runtime changes, and best-effort event publication.
- Room command modules and `game/transitions/` own writes. Game transitions
  commit atomically and return runtime directives and events; they never
  publish directly.
- `domain/game/` owns pure caller, seat, turn, legality, trick, and scoring
  rules. Snapshots, transitions, bots, annotations, and archives consume those
  rules instead of reimplementing them.
- `game/snapshots/` and `services/gameState.ts` are reads. Loading
  `GET /api/games/:roomCode/state` never schedules a timer or starts a bot.
- Runtime directives are applied before events are published. Publication
  failures are logged and reported to Sentry but do not turn a committed
  request into an HTTP failure.

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
setup uses `npm run db:test:prepare`, which refuses any host/database other than
the explicit local `becca_test` target. Annotation status/import/export uses
the guarded scripts under `scripts/annotations/`; see
[`scripts/annotations/README.md`](scripts/annotations/README.md).

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

After the HTTP server starts, `recoverActiveRuntime()` scans started,
unfinished, unpaused rooms. Each room is locked, its persisted caller/current
turn is read, bot seats are restored, and one runtime directive is scheduled
only when an equivalent timer is not already present. Practice resume commits
the unpause first and then calls the same `recoverRoomRuntime()` path. Game-state
reads never recover runtime, so repeated snapshots cannot create timers or bot
moves.

### Backend and AI Contract

The TypeScript backend is authoritative for persisted online games, turn
validation, and accepted moves. The Python package owns training, simulation,
state adaptation, and model inference; its rules mirror the backend for those
workflows.

`tests/integration/botStateFixtures.test.ts` consumes
`../ai/serving/fixtures/bot_states.json` to verify the real TypeScript
serializer against Python-generated states. That suite requires the full
parent checkout with both submodules initialized and is skipped with an
explicit message in a standalone backend checkout.

### Test Architecture

| Project | Runs | DB Required | Files |
|---------|------|-------------|-------|
| `unit` | In parallel | No | `tests/unit/**/*.test.ts` |
| `integration` | In band (serial) | Yes (`becca_test`) | `tests/integration/**/*.test.ts` |

- **Unit tests** cover pure card parsing, scoring, trick rules, room-code generation, and the production chat sanitizer.
- The annotation scenario unit suite enforces the exact public-state contract,
  chronological plays, hand-bound legal actions, and hidden-field rejection.
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
| `scripts/annotations/status.sh` | Show catalog and response counts using an explicit environment file |
| `scripts/annotations/import.sh` | Dry-run or apply a plan-token-confirmed scenario import |
| `scripts/annotations/export.sh` | Atomically create a mode-`600` pseudonymous JSONL export |
| `npm run practice:export` | Emit archived practice games as JSONL, one game per line |

## Expert Annotation Data

All annotation endpoints use the normal BECCA account cookie.
`POST /api/annotations/access` checks the backend-only
`ANNOTATION_ACCESS_CODE` and permanently grants expert access to that account.
One current response row is stored per account and scenario, so identical
retries update the same row and keep the contribution count unchanged. Answers
remain associated with the account so progress survives login on another
browser. There is no response-history portal.

The AI package creates deterministic scenario batches offline. Use the guarded
wrapper to inspect the target and validate a batch without writing:

```sh
scripts/annotations/import.sh scenarios.json manifest.json \
  --env-file "$ANNOTATION_ENV_FILE" \
  --replace-active
```

For routine database operations, prefer the guarded wrappers documented in
[`scripts/annotations/README.md`](scripts/annotations/README.md). They require
an explicit mode-`600` environment file, display only the database host and
name, and keep import database-read-only by default. A dry run emits a plan
token bound to the full connection configuration, compiled toolkit, batch hash,
replacement mode, exact scenario catalog, and current write counts. Apply
requires that exact token and aborts if any relevant input or catalog state
changed.

Imports require each scenario to declare `play_card` or `choose_briscola` and
are transactional and idempotent. Existing scenario codes and state hashes
cannot be changed. With `--replace-active`, scenarios outside the incoming
batch are deactivated in the same transaction; their rows and responses remain
stored. The command remains database-write-free unless `--apply` is present.

The next-scenario query keeps each user's answers near the 20% easy, 40%
medium, 40% hard mix, then ranks unanswered scenarios by
`importance / sqrt(1 + response count)`. There is no response cap. Skips clear
all selected-action fields and may include a trimmed optional comment of at
most 500 characters. Every response also records the user's easy, medium, or
hard rating.

For production, deploy the annotation migration and API before importing. Run
the importer from a controlled environment with the production `DATABASE_URL`
and `DIRECT_URL` injected, never pasted into shell history. The command without
`--apply` validates and queries for conflicts but writes nothing to the
database. Confirm the database host and dry-run summary before adding `--apply`.
The complete generation, import, launch, replenishment, and recovery runbook is
`ai/docs/EXPERT_DATA_COLLECTION.md` in the parent BECCA checkout.

Each export row includes the decision type, exact visible scenario, matching
discriminated selected action or skip, and optional skip comment. It
pseudonymizes the account ID and never selects the username or email. Put a
private stable salt in the protected environment file and name a new output:

```sh
mkdir -p "$HOME/.becca/annotation-exports"
chmod 700 "$HOME/.becca/annotation-exports"
scripts/annotations/export.sh \
  --env-file "$ANNOTATION_ENV_FILE" \
  --output "$HOME/.becca/annotation-exports/annotations-$(date +%F).jsonl"
```

The export validates every row before atomically creating a mode-`600` file and
refuses to overwrite an existing path.

## Practice Game Data

Practice games are training data. A practice room is deleted as soon as the
human leaves it, and the sweeper deletes finished or day-old ones, so
`retirePracticeRoom` snapshots the game into one `PracticeMatch` row on its way
out, in the same transaction, so a failed snapshot keeps the game and runtime
for the next attempt instead of losing either.

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
| GET | `/api/annotations/status` | Account | Get account access status and contribution count |
| POST | `/api/annotations/access` | Account + code | Grant expert access to the authenticated account |
| GET | `/api/annotations/next` | Expert account | Get the next unanswered public scenario |
| POST | `/api/annotations/responses` | Expert account | Upsert the account's current answer or skip |
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

## CI and production deployment

GitHub Actions validates the complete Prisma migration history against a fresh
PostgreSQL database, verifies that it matches `schema.prisma`, and runs the
integration suite without the local-only `prisma db push` preparation. It also
builds and starts the production Dockerfile, so a green `CI` workflow covers
the same migration and runtime path used by Render.

Production deployment runs only after the `CI` workflow succeeds on `main`.
Configure the repository secret `RENDER_DEPLOY_HOOK_URL` with the backend
service's Render deploy hook, then disable Render's direct auto-deploy for the
service. A missing secret fails the deployment workflow.

The workflow passes the tested GitHub commit as the deploy hook's `ref`, waits
for `/version` to report that exact commit, and then requires `/ready` to
confirm database connectivity. The version endpoint reads Render's
`RENDER_GIT_COMMIT`; `GIT_COMMIT_SHA` is an explicit fallback for other
deployment systems.

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
