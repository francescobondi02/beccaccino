# Becca Online — Development Guide

## Quick Start

```sh
# 0. Clone with submodules
git clone --recursive https://github.com/francescobondi02/beccaccino.git
cd beccaccino

# 1. Create local configuration once; set a private JWT_SECRET and BOT_SERVICE_TOKEN
cp backend/.env.example backend/.env

# 2. Start the complete local app, with hot reload
make dev
```

- Backend: `http://localhost:8000`
- Frontend: `http://localhost:8081`
- Adminer (DB UI): `http://localhost:8080`
- Bot: `http://localhost:8011/health` (inference requires the shared token)

`make dev` uses Docker Compose for PostgreSQL, backend, frontend and the trained
bot. It explicitly sets development mode, local database URLs and local browser
URLs. Inherited production database or frontend URLs cannot redirect this stack.
The bot token comes from the ignored `backend/.env`; Python and Node share it.
Container dependencies stay in named volumes, separate from host `node_modules`.
The trained, hash-verified weights are committed in `ai/serving/models/`.
No local Node/Python installation or separate model download is needed.
The backend waits for PostgreSQL and the model to become healthy.
There is no random-model fallback during startup.
Restricted networks can set a public `PIP_INDEX_URL` mirror in `backend/.env`
for the bot image build; CPU PyTorch also requires `download.pytorch.org`.
Do not put credentials in build arguments.
For corporate npm access, set `NPM_CONFIG_REGISTRY` in that same file to the
registry already approved and configured on the host. Containers do not inherit
the host's npm configuration. Do not disable Defender or TLS verification.

Stop without deleting the database:

```sh
make stop
```

`make dev` stays in the foreground; Ctrl+C stops the app. `make stop` also removes
its containers, but retains the database and dependency volumes.

## Production commands and environment

Production does **not** use the local Compose file or copy `backend/.env`.
Render and Vercel supply their own environment variables. There is no command
that rewrites local secrets into production secrets.

| Component | Production command | Configuration |
| --- | --- | --- |
| Backend on Render | Existing `backend/Dockerfile`: build with `npm run build`; start with `npx prisma migrate deploy && node dist/index.js` | `NODE_ENV=production` is set by the image; Render supplies database URLs, JWT secret, frontend origin and bot URL/token |
| Frontend on Vercel | Existing deploy workflow: `vercel pull --environment=production`, `vercel build --prod`, `vercel deploy --prebuilt --prod` | Vercel Production variables provide `VITE_API_URL` and `VITE_SOCKET_URL`; never frontend secrets |
| Bot on Render | `ai/Dockerfile`: `uvicorn serving.app:app --host 0.0.0.0 --port "$PORT"` | Private `BOT_SERVICE_TOKEN`, matching the backend; Render supplies `PORT` |
| Neon | No application process; backend startup runs `prisma migrate deploy` | `DATABASE_URL` is the pooled Neon URL; `DIRECT_URL` is the direct URL for the **same production database** |

The bot image uses the same committed PyTorch artifact locally and in production.
`forte` selects `ai/serving/models/kaggle_2026_10_25.pt`, with its frozen
1888-feature observation encoder. ONNX is not required. CI verifies model loading,
legal actions, and the production container before invoking the Render deploy hook.

The current Vercel workflow already selects Production configuration. The backend
workflow calls the existing Render hook only after successful CI on a push to main.
Changing these files does not deploy anything: no cloud upload, migration or
paid service is started by local development.

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

### E2E Tests (Playwright)

The multiplayer tests coordinate 4 independent browser contexts through the
lobby and first trick. The annotation test uses a normal BECCA account, grants
expert access, and verifies account-linked answer and skip submissions on
desktop and mobile.

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
- **first-trick.spec.ts** — Briscola selection → 4 players complete the first trick in correct turn order
- **annotation.spec.ts** — Account login → expert access → answer and skip submissions with difficulty ratings

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

## Expert Annotation Production Operations

Scenario generation is offline and cannot modify production. The production
workflow has three separate gates:

1. Deploy the backend revision containing the annotation migration and API.
2. Generate and validate a deterministic batch from `ai/`.
3. Run the backend importer against production, first without `--apply` and
   then with `--apply` after verifying the target and summary.

Configure `ANNOTATION_ACCESS_CODE` only in the backend hosting environment. It
is a shared invitation code that permanently grants annotation access to an
already authenticated BECCA account; it is not a generator seed or frontend
variable.

Use [`ai/docs/EXPERT_DATA_COLLECTION.md`](ai/docs/EXPERT_DATA_COLLECTION.md) as
the authoritative operator runbook. It covers one-time seed custody, batch
naming, generation, manifest inspection, production import, launch
verification, replenishment, and failure recovery. Never import a batch before
the corresponding backend migration is deployed, and never use `--apply`
without first reviewing the dry run against the same database.

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
