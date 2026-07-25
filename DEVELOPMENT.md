# Becca Online — Development Guide

## Quick Start

```sh
# 0. Clone with submodules
git clone --recursive https://github.com/francescobondi02/beccaccino.git
cd beccaccino

# 1. Copy env files and fill in values
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# 2. Start backend + database
docker compose up

# 3. Start frontend (separate terminal)
cd frontend && npm install && npm run dev
```

- Backend: `http://localhost:8000`
- Frontend: `http://localhost:8081`
- Adminer (DB UI): `http://localhost:8080`

To run in the background:

```sh
docker compose up -d
```

---

## Running Tests

### Backend Tests

Tests are split into two Jest projects: **unit** (no DB) and **integration** (real DB).

#### Prerequisites

The integration tests require a dedicated `becca_test` database. Create it once:

```sh
cd backend
DB="postgresql://postgres:postgres@localhost:5432/becca_test"
DATABASE_URL="$DB" DIRECT_URL="$DB" npx prisma db push
```

Make sure `docker compose up` is running before running integration tests.

`becca_test` is built with `db push`, not `migrate deploy`, so it deliberately has
**no migration history** — `migrate deploy` against it fails with P3005, which is
expected, not a problem. Verify new migrations against the dev `becca` database
instead (`npm run migrate`).

> **`DIRECT_URL` is required, even locally.** Prisma validates that every `env()`
> in the datasource block resolves, so an unset `DIRECT_URL` fails schema
> validation for *every* prisma command — including `npm run dev` and `npm test`.
> It does not fall back to `DATABASE_URL`. Copy `.env.example` (which sets it) and
> mirror `DATABASE_URL` locally; only Neon needs the two to differ.

#### Commands

```sh
cd backend

npm test                  # run all tests (unit + integration)
npm run test:unit         # run only unit tests (no DB needed)
npm run test:integration  # run only integration tests (requires DB)
```

### Frontend Unit Tests

```sh
cd frontend

npm test                  # run all unit tests (Vitest)
npm run test:watch        # watch mode for development
npm run test:coverage     # with coverage report
```

### E2E Tests (Playwright — Multiplayer)

End-to-end tests simulate 4 real browsers playing a complete game together. Each player is an independent browser context with its own session.

#### Prerequisites

```sh
docker compose up -d          # Start DB
cd backend && npm run dev     # Start backend (port 8000)
cd frontend && npm run dev    # Start frontend (port 8081)
```

#### Commands

```sh
cd frontend

npm run test:e2e              # Run headless (CI-friendly)
npm run test:e2e:headed       # Watch the bots play in real browsers
npm run test:e2e:ui           # Playwright interactive UI mode
```

#### What the E2E tests cover

- **lobby-to-game.spec.ts** — 4 players register, create room, join, choose teams, ready up, game starts, verify 10 cards dealt
- **full-game.spec.ts** — Briscola selection → 4 players play a complete hand in correct turn order

#### Debugging failures

```sh
cd frontend
npx playwright show-report    # Open HTML report with traces and screenshots
```

See `frontend/DEVELOPMENT.md` for full E2E documentation.

### Test Structure

```
backend/tests/
  unit/
    computePoints.test.ts       # scoring logic, deterministic seeded shuffle
    determineHandWinner.test.ts # trick-winner logic
  integration/
    users.test.ts               # user registration via API + DB check
    game.test.ts                # full round flow (setup → briscola → play)
    fullGame.test.ts            # multi-round game until one team wins
  helpers/
    gameHelpers.ts              # shared helpers: setupGame, oneRound, etc.
  loadTestEnv.ts                # sets DATABASE_URL before PrismaClient loads
  setup.ts                      # mocks Socket.io, sets NODE_ENV=test
  teardown.ts                   # disconnects Prisma after all tests
```

Unit tests are pure — no database, no HTTP. Integration tests use a real `becca_test`
database and are always run in band (`--runInBand`) to avoid connection conflicts.

Each integration test suite calls `clearDatabase()` in `beforeEach` to ensure isolation.

---

## Stopping the Project

```sh
docker compose down           # stop containers
docker compose down -v        # stop and delete database volume (destructive)
```

---

## Database Management (Prisma)

All commands should be run from the `backend/` directory.

```sh
# Apply pending migrations
npx prisma migrate deploy

# Create a new migration after editing schema.prisma
npx prisma migrate dev --name <migration_name>

# Regenerate Prisma client after schema changes
npx prisma generate

# Reset the dev database (drops all data)
npx prisma migrate reset

# Open Prisma Studio (visual DB editor) at http://localhost:5555
npx prisma studio
```

---

## Environment Variables

**`backend/.env`** (development):

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/becca"
JWT_SECRET="your_secret_key"
PORT=8000
FRONTEND_URL="http://localhost:8081"
```

**`backend/.env.test`** (integration tests — used for reference, actual injection is via `loadTestEnv.ts`):

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/becca_test"
JWT_SECRET="test-secret"
NODE_ENV="test"
PORT=8000
FRONTEND_URL="http://localhost:8081"
```

---

## Typical Workflows

### Daily Development

```sh
docker compose up -d
cd frontend && npm run dev   # separate terminal
cd backend && npm run test:unit  # fast feedback loop, no DB needed
docker compose down
```

### After Editing `schema.prisma`

```sh
npx prisma migrate dev --name <description>
# npx prisma generate is usually run automatically
docker compose restart backend
```

### Running Integration Tests

```sh
docker compose up -d
cd backend && npm run test:integration
```

---

## Docker Reference

```sh
# View running containers
docker ps

# View logs
docker compose logs -f          # all services
docker compose logs -f backend  # backend only

# Restart a service
docker compose restart backend

# Rebuild after Dockerfile changes
docker compose up --build

# Enter a container
docker exec -it becca-backend sh
docker exec -it becca-db psql -U postgres -d becca
```

---

## Troubleshooting

**Port already in use:**

```sh
lsof -i :8000   # find process on port (also try 5432, 8080)
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
cd backend && npx prisma generate
```

**Integration tests hitting dev database instead of test database:**

The `tests/loadTestEnv.ts` file must override `DATABASE_URL` before any module loads.
It is registered under `setupFiles` (not `setupFilesAfterEnv`) in `jest.config.js` for this reason.
If tests are writing to `becca` instead of `becca_test`, check that the integration project config still has `setupFiles: ["<rootDir>/tests/loadTestEnv.ts"]`.

**Database in inconsistent state:**

```sh
docker compose down -v
docker compose up
```

---

## Useful SQL Queries

```sh
docker exec -it becca-db psql -U postgres -d becca
```

```sql
\dt                          -- list all tables
\d "TableName"               -- show table schema
SELECT * FROM "User";
SELECT * FROM "GameRoom";
TRUNCATE "User" CASCADE;     -- delete all users (cascades)
```

