# Backend — Development Guide

## Prerequisites

- **Node.js** 24+ (matches Dockerfile)
- **Docker** (for PostgreSQL database)
- The database runs via Docker Compose from the project root

## Environment Setup

```sh
cp .env.example .env
# Edit .env to set a real JWT_SECRET: openssl rand -hex 32
```

The defaults work with Docker Compose out of the box. Only `JWT_SECRET` needs to be changed from the placeholder.

For integration tests, a separate `.env.test` is already provided:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/becca_test"
JWT_SECRET="test-secret"
NODE_ENV="test"
PORT=8000
FRONTEND_URL="http://localhost:8081"
```

## Starting the Backend

### Option A: With Docker Compose (recommended for development)

From the **project root**:

```sh
docker compose up
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
│   ├── index.ts            # Server entry: HTTP + Socket.IO + auth middleware
│   ├── app.ts              # Express app (CORS, routes, middleware)
│   ├── db.ts               # Prisma client singleton
│   ├── socketInstance.ts    # Socket.IO singleton (get/set)
│   ├── controllers/        # Request handlers
│   │   ├── userController.ts    # register, login, logout, getCurrentUser
│   │   ├── roomController.ts    # createRoom, joinRoom, setPlayerReady, leaveRoom
│   │   ├── chooseTeam.ts        # Team selection
│   │   └── gameController.ts    # chooseBriscola, playCard, getGameState
│   ├── services/           # Business logic
│   │   ├── gameService.ts       # setupRound, playCard (turn enforcement, scoring)
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
# Make sure docker compose is running (for the PostgreSQL instance)
docker compose up -d

cd backend
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/becca_test" npx prisma db push
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
```

### Test Architecture

| Project | Runs | DB Required | Files |
|---------|------|-------------|-------|
| `unit` | In parallel | No | `tests/unit/**/*.test.ts` |
| `integration` | In band (serial) | Yes (`becca_test`) | `tests/integration/**/*.test.ts` |

- **Unit tests** are pure — they test `computePoints`, `determineHandWinner`, `generateRoomCode`, and `cardService` logic without any database.
- **Integration tests** use `supertest` against the Express app with a real PostgreSQL database. Auth middleware is bypassed via `NODE_ENV=test`.
- Each integration test calls `clearDatabase()` in `beforeEach` for isolation.

## Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run dev` | Generate Prisma + migrate + start dev server with hot-reload |
| `npm test` | Run all Jest tests |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration tests only (serial) |
| `npm run build` | Generate Prisma + compile TypeScript |
| `npm start` | Run compiled `dist/index.js` (production) |
| `npm run migrate` | Apply Prisma migrations |

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/users/register` | No | Register with username + password |
| POST | `/api/users/login` | No | Login, returns HTTP-only cookie |
| POST | `/api/users/logout` | Yes | Clear auth cookie |
| GET | `/api/users/me` | Yes | Get current user |
| POST | `/api/rooms/` | Yes | Create a new room |
| GET | `/api/rooms/available` | Yes | List joinable rooms + active games |
| GET | `/api/rooms/:code` | Yes | Get room details |
| POST | `/api/rooms/join` | Yes | Join a room by code |
| POST | `/api/rooms/:code/choose-team` | Yes | Choose team 0 or 1 |
| POST | `/api/rooms/:code/ready` | Yes | Toggle ready state |
| POST | `/api/rooms/:code/leave` | Yes | Leave an open lobby; active games return 409 and finished-game history is preserved |
| POST | `/api/games/choose-briscola` | Yes | Choose trump suit |
| POST | `/api/games/play-card` | Yes | Play a card |
| GET | `/api/games/playable-cards/:code` | Yes | Get legal cards for current turn |
| GET | `/api/games/:code/state` | Yes | Get full game state |
| GET | `/health` | No | Health check |

## Troubleshooting

**Port already in use:**
```sh
lsof -i :8000
kill -9 <PID>
```

**Cannot connect to database:**
```sh
docker ps                      # verify DB container is running
docker compose logs db         # check DB logs
docker compose restart db
```

**Prisma Client not generated:**
```sh
npx prisma generate
```

**Integration tests hitting dev database:**
Check that `tests/loadTestEnv.ts` is listed under `setupFiles` in `jest.config.js`.
