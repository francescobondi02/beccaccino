# Becca Online — Development Guide

## Quick Start

```sh
git clone https://github.com/francescobondi02/beccaccino.git
cd beccaccino
make dev
```

See [Develop locally](./README.md#develop-locally) for ports, seeded accounts,
the phone setup and every `make` target. The host needs only Docker and make.
Production never uses the local Compose file, its dev-only defaults or the seed.

## Production commands and environment

Production does **not** use the local Compose file or copy `backend/.env`.
Render and Vercel supply their own environment variables. There is no command
that rewrites local secrets into production secrets.

| Component | Production command | Configuration |
| --- | --- | --- |
| Backend on Render | Existing `backend/Dockerfile`: build with `npm run build`; start with `npx prisma migrate deploy && node dist/index.js` | `NODE_ENV=production` is set by the image; Render supplies database URLs, JWT secret and bot URL/token |
| Frontend on Vercel | `vercel build` of `frontend/` (deploy not automated yet) | No API origin variables: the browser calls `/api` and Vercel proxies it to Render; never frontend secrets |
| Bot on Render | `ai/Dockerfile`: `uvicorn serving.app:app --host 0.0.0.0 --port "$PORT"` | Private `BOT_SERVICE_TOKEN`, matching the backend; Render supplies `PORT` |
| Neon | No application process; backend startup runs `prisma migrate deploy` | `DATABASE_URL` is the pooled Neon URL; `DIRECT_URL` is the direct URL for the **same production database** |

The bot image uses the same committed PyTorch artifact locally and in production.
`forte` selects `ai/serving/models/kaggle_2026_10_25.pt`, with its frozen
1888-feature observation encoder. ONNX is not required. CI verifies model loading,
legal actions, and the production container.

Changing these files does not deploy anything: no cloud upload, migration or
paid service is started by local development.

---

## Running Tests

### Backend Tests

Tests are split into two Jest projects: **unit** (no DB) and **integration** (real DB).

#### Prerequisites

`make test` runs both projects inside the containers. It migrates the
`becca_test` database first (`npm run db:test:prepare`), so no manual setup is
needed. To run a single file:

```sh
docker run --rm --network container:becca-db --volumes-from becca-backend \
  --volume "$PWD/ai:/ai:ro" --workdir /app node:24-alpine3.21 \
  npx jest --runInBand tests/integration/botTurns.test.ts
```

> **`DIRECT_URL` is required, even locally.** Prisma validates that every `env()`
> in the datasource block resolves, so an unset `DIRECT_URL` fails schema
> validation for *every* prisma command. It does not fall back to
> `DATABASE_URL`; only Neon needs the two to differ.

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

### E2E Tests (Playwright)

The multiplayer tests coordinate 4 independent browser contexts through the
lobby and first trick.

#### Prerequisites

```sh
docker compose up -d --wait db # Start only PostgreSQL
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
- **first-trick.spec.ts** — Briscola selection → 4 players complete the first trick in correct turn order

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
    roundScore.test.ts          # round scoring, deterministic seeded shuffle
    gameScore.test.ts           # cumulative scores and game winner
    trickWinner.test.ts         # trick-winner logic
  integration/
    users.test.ts               # user registration via API + DB check
    game.test.ts                # full round flow (setup → briscola → play)
    fullGame.test.ts            # multi-round game until one team wins
  helpers/
    gameDriver.ts               # shared helpers: setupGame, oneRound, etc.
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
make stop     # stop containers, keep data
make reset    # delete the database and dependency volumes (destructive), then start fresh
```

---

## Database Management (Prisma)

Run these inside the backend container: `docker compose exec backend sh`.

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

`docker-compose.yml` sets every variable the local backend needs, with dev-only
defaults. See [Develop locally](./README.md#develop-locally) for overrides.
Integration tests get theirs from `backend/tests/loadTestEnv.ts`.

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
make dev

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
docker compose restart backend   # runs prisma generate on start
```

**Integration tests hitting dev database instead of test database:**

The `tests/loadTestEnv.ts` file must override `DATABASE_URL` before any module loads.
It is registered under `setupFiles` (not `setupFilesAfterEnv`) in `jest.config.js` for this reason.
If tests are writing to `becca` instead of `becca_test`, check that the integration project config still has `setupFiles: ["<rootDir>/tests/loadTestEnv.ts"]`.

**Database in inconsistent state:**

```sh
make reset
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
