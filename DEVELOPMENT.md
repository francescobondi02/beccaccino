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

For integration tests, a separate `.env.test` is already provided:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/becca_test"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/becca_test"
JWT_SECRET="test-secret"
ANNOTATION_ACCESS_CODE="test-access-code"
NODE_ENV="test"
PORT=8000
FRONTEND_URL="http://localhost:8081"
```

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
npm install
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
│   ├── socketInstance.ts    # Socket.IO singleton (get/set)
│   ├── annotations/         # Annotation scenario validation and selection
│   ├── domain/              # Card types and public DTO projections
│   ├── controllers/        # Request handlers
│   │   ├── userController.ts    # register, login, logout, getCurrentUser
│   │   ├── annotationController.ts # annotation status, access, next scenario, responses
│   │   ├── roomController.ts    # createRoom, joinRoom, setPlayerReady, leaveRoom
│   │   ├── chooseTeam.ts        # Team selection
│   │   └── gameController.ts    # chooseBriscola, playCard, getGameState
│   ├── services/           # Business logic
│   │   ├── gameService.ts       # Atomic transitions and timer directives
│   │   ├── gameState.ts         # Browser state loading and timer recovery
│   │   ├── turnCoordinator.ts   # Controller-facing transition coordinator
│   │   ├── turnTimer.ts         # Timers, bots, autoplay, timeout state
│   │   ├── roomCommands.ts      # Shared room lifecycle, team, and ready commands
│   │   ├── practiceRoomSweeper.ts # Periodic abandoned-practice cleanup
│   │   └── cardService.ts       # playableCards (follow-suit rules)
│   ├── sockets/            # WebSocket event handlers
│   │   └── room.ts             # join_lobby, join_room, choose_team, set_ready
│   ├── routes/             # Express route definitions
│   ├── scripts/            # Operational CLIs, including JSONL annotation export
│   ├── middleware/          # auth.ts (JWT cookie verification)
│   └── utils/              # Pure functions
│       ├── computePoints.ts
│       ├── determineHandWinner.ts
│       ├── generateRoomCode.ts
│       ├── jwt.ts
│       └── password.ts
├── prisma/
│   └── schema.prisma       # Database schema
├── tests/
│   ├── unit/               # Pure logic tests (no DB)
│   ├── integration/        # API tests (real DB)
│   ├── helpers/            # Shared test utilities
│   ├── setup.ts            # Mock socket, set NODE_ENV=test
│   ├── loadTestEnv.ts      # Override DATABASE_URL for tests
│   └── teardown.ts         # Disconnect Prisma after tests
└── Dockerfile              # Production build
```

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

### Test Architecture

| Project | Runs | DB Required | Files |
|---------|------|-------------|-------|
| `unit` | In parallel | No | `tests/unit/**/*.test.ts` |
| `integration` | In band (serial) | Yes (`becca_test`) | `tests/integration/**/*.test.ts` |

- **Unit tests** cover pure card parsing, scoring, trick rules, room-code generation, and the production chat sanitizer.
- The annotation scenario unit suite enforces the exact public-state contract,
  chronological plays, hand-bound legal actions, and hidden-field rejection.
- **Integration tests** use Supertest and real Socket.IO clients against the Express/server factory with PostgreSQL. Auth bypass is available only when explicitly enabled in test mode.
- Each integration test calls `clearDatabase()` in `beforeEach` for isolation.
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
| `npm run annotations:import -- <batch> <manifest> [--apply]` | Validate or import an offline scenario batch |
| `npm run annotations:export` | Emit self-contained pseudonymous annotation rows as JSONL |

## Expert Annotation Data

All annotation endpoints use the normal BECCA account cookie.
`POST /api/annotations/access` checks the backend-only
`ANNOTATION_ACCESS_CODE` and permanently grants expert access to that account.
One current response row is stored per account and scenario, so identical
retries update the same row and keep the contribution count unchanged. Answers
remain associated with the account so progress survives login on another
browser. There is no response-history portal.

The AI package creates deterministic scenario batches offline. Build the
backend, validate a batch with a dry run, then import it explicitly:

```sh
npm run build
npm run annotations:import -- scenarios.json manifest.json
npm run annotations:import -- scenarios.json manifest.json --apply
```

Imports are transactional and idempotent. Existing scenario codes and state
hashes cannot be changed. The next-scenario query keeps each user's answers
close to a 20% easy, 40% medium, 40% hard mix, then ranks unanswered scenarios
by `importance / sqrt(1 + response count)`. There is no response cap. Skips
retain null selected-card fields and may include a trimmed optional comment of
at most 500 characters. Every response also records the user's easy, medium, or
hard rating.

For production, deploy the annotation migration and API before importing. Run
the importer from a controlled environment with the production `DATABASE_URL`
and `DIRECT_URL` injected, never pasted into shell history. The command without
`--apply` validates and queries for conflicts but writes nothing. Confirm the
database host and dry-run summary before adding `--apply`. The complete
generation, import, launch, replenishment, and recovery runbook is
`ai/docs/EXPERT_DATA_COLLECTION.md` in the parent BECCA checkout.

Each export row includes the exact visible scenario, the selected action or
skip, and the optional skip comment. It pseudonymizes the account ID and never
selects the username or email. Set a private stable salt and redirect stdout to
create a JSONL export:

```sh
ANNOTATION_EXPORT_SALT="<at-least-16-private-characters>" \
npm run annotations:export > annotations.jsonl
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
| GET | `/api/rooms/getExitedRooms` | Yes | List unfinished rooms for compatibility clients |
| GET | `/api/rooms/:roomCode` | Yes | Get room details |
| POST | `/api/rooms/join` | Yes | Join a room by code |
| POST | `/api/rooms/:roomCode/choose-team` | Yes | Choose team 0 or 1 |
| POST | `/api/rooms/:roomCode/ready` | Yes | Toggle ready state |
| POST | `/api/rooms/:roomCode/leave` | Yes | Leave an open lobby; practice rooms are deleted, active multiplayer returns 409, and finished multiplayer history is preserved |
| POST | `/api/games/choose-briscola` | Yes | Choose trump suit |
| POST | `/api/games/play-card` | Yes | Play a card |
| GET | `/api/games/playable-cards/:roomCode` | Yes | Get legal cards for current turn |
| GET | `/api/games/:roomCode/state` | Yes | Get full game state |
| GET | `/health` | No | Health check |
| GET | `/ready` | No | Database readiness check |

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
