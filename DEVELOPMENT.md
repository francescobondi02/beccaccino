# Backend — Development Guide

## Prerequisites

- **Node.js** 24+ (matches Dockerfile)
- **Finch** (for the local PostgreSQL database)
- The database runs via Finch Compose from the project root

## Environment Setup

```sh
cp .env.example .env
# Edit .env to set a real JWT_SECRET: openssl rand -hex 32
```

The defaults work with Finch Compose out of the box. Only `JWT_SECRET` needs to be changed from the placeholder.

For integration tests, a separate `.env.test` is already provided:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/becca_test"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/becca_test"
JWT_SECRET="test-secret"
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
│   ├── index.ts            # Process entry: env, listen, metrics, shutdown
│   ├── server.ts           # HTTP + Socket.IO factory, auth and IP admission
│   ├── app.ts              # Express app, routes, health/readiness probes
│   ├── gameConfig.ts       # Environment-backed game rules
│   ├── db.ts               # Prisma client singleton
│   ├── socketInstance.ts    # Socket.IO singleton (get/set)
│   ├── domain/              # Card types and public DTO projections
│   ├── controllers/        # Request handlers
│   │   ├── userController.ts    # register, login, logout, getCurrentUser
│   │   ├── roomController.ts    # createRoom, joinRoom, setPlayerReady, leaveRoom
│   │   ├── chooseTeam.ts        # Team selection
│   │   └── gameController.ts    # chooseBriscola, playCard, getGameState
│   ├── services/           # Business logic
│   │   ├── gameService.ts       # Atomic transitions and timer directives
│   │   ├── gameState.ts         # Browser state loading and timer recovery
│   │   ├── turnCoordinator.ts   # Controller-facing transition coordinator
│   │   ├── turnTimer.ts         # Timers, bots, autoplay, timeout state
│   │   ├── roomCommands.ts      # Shared room lifecycle, team, and ready commands
│   │   └── cardService.ts       # playableCards (follow-suit rules)
│   ├── sockets/            # WebSocket event handlers
│   │   └── room.ts             # join_lobby, join_room, choose_team, set_ready
│   ├── routes/             # Express route definitions
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
RUN_LIVE_BOT_TESTS=true BOT_SERVICE_URL=http://localhost:8011 \
npm run test:integration -- tests/integration/botLive.test.ts
```

### Test Architecture

| Project | Runs | DB Required | Files |
|---------|------|-------------|-------|
| `unit` | In parallel | No | `tests/unit/**/*.test.ts` |
| `integration` | In band (serial) | Yes (`becca_test`) | `tests/integration/**/*.test.ts` |

- **Unit tests** cover pure card parsing, scoring, trick rules, room-code generation, and the production chat sanitizer.
- **Integration tests** use Supertest and real Socket.IO clients against the Express/server factory with PostgreSQL. Auth bypass is available only when explicitly enabled in test mode.
- Each integration test calls `clearDatabase()` in `beforeEach` for isolation.
- Shared teardown closes HTTP servers, sockets, Prisma, and all turn timers.

## Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run dev` | Generate Prisma + migrate + start dev server with hot-reload |
| `npm test` | Run all Jest tests |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration tests only (serial) |
| `npm run typecheck` | Compile checks without emitting files |
| `npm run build` | Generate Prisma + compile TypeScript |
| `npm run db:test:prepare` | Apply the Prisma schema to the isolated `becca_test` database |
| `npm start` | Run compiled `dist/index.js` (production) |
| `npm run migrate` | Apply Prisma migrations |

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
| GET | `/api/rooms/getExitedRooms` | Yes | List unfinished rooms for compatibility clients |
| GET | `/api/rooms/:roomCode` | Yes | Get room details |
| POST | `/api/rooms/join` | Yes | Join a room by code |
| POST | `/api/rooms/:roomCode/choose-team` | Yes | Choose team 0 or 1 |
| POST | `/api/rooms/:roomCode/ready` | Yes | Toggle ready state |
| POST | `/api/rooms/:roomCode/leave` | Yes | Leave an open lobby; active games return 409 and finished-game history is preserved |
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
