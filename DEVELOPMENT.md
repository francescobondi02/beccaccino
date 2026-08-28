# Becca Online — Development Guide

## Prerequisites

- Node.js 24+
- Finch with Compose support
- Python 3.11+ for the AI package

## Quick Start

```sh
# 0. Clone with submodules
git clone --recursive https://github.com/francescobondi02/beccaccino.git
cd beccaccino

# 1. Copy env files and fill in values
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# 2. Start backend + database
finch compose up

# 3. Start frontend (separate terminal)
cd frontend && npm ci && npm run dev
```

- Backend: `http://localhost:8000`
- Frontend: `http://localhost:8081`
- Adminer (DB UI): `http://localhost:8080`

To run in the background:

```sh
finch compose up -d
```

---

## Running Tests

### Pre-push Gate

Before pushing the backend or frontend submodule to `develop`, run the complete
web-application gate from the project root:

```sh
./scripts/pre-push.sh
```

The gate starts only the Finch PostgreSQL service, creates a temporary database
for migration replay plus a temporary test schema inside the guarded local
`becca_test` database, and then runs:

- backend migration parity, typecheck, build, unit tests, and integration tests
- frontend typecheck, lint, build-metadata tests, coverage, and production build
- the complete Playwright suite against dedicated backend, frontend, and
  deterministic bot-stub ports

It never reuses servers on ports `8000` or `8081`. Logs, the Playwright HTML
report, traces, and screenshots are retained under `test-artifacts/pre-push/`;
temporary services and schemas are removed on success, failure, or Ctrl-C.

For manual verification after all automated checks pass:

```sh
./scripts/pre-push.sh --keep-open
```

Open `http://localhost:18081`. The verified stack remains available until
Ctrl-C, then performs the same cleanup.

The web gate does not install or validate the Python package. Before pushing
`ai/`, run its independent gate:

```sh
cd ai
pytest
ruff check .
ruff format --check .
python -m scripts.gen_bot_fixtures
git diff --exit-code serving/fixtures/
```

### Backend Tests

Tests are split into two Jest projects: **unit** (no DB) and **integration** (real DB).

#### Prerequisites

The integration tests require a dedicated `becca_test` database. Create it once:

```sh
cd backend
npm run db:test:prepare
```

Make sure `finch compose up -d db` is running before integration tests.

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

Start PostgreSQL with `finch compose up -d db`. Playwright starts isolated
backend and frontend processes unless `E2E_REUSE_SERVERS=true` is set.

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
- **practice-pause-resume.spec.ts** — Practice pause → home listing → resume → direct paused-room overlay → confirmed abandon on desktop and mobile

#### Debugging failures

```sh
cd frontend
npx playwright show-report    # Open HTML report with traces and screenshots
```

See `frontend/DEVELOPMENT.md` for full E2E documentation.

### Test Structure

```
backend/tests/
  unit/                         # pure rules, parsers, codecs, and policies
  integration/                  # API, database, sockets, runtime, and archives
  helpers/
    database.ts                 # shared complete reset
    serverHarness.ts            # shared ephemeral HTTP server
    gameDriver.ts               # deterministic game setup and play
  loadTestEnv.ts                # selects and guards the test database
  setup.ts                      # common Jest setup
  teardown.ts                   # closes servers, sockets, timers, and Prisma
```

Unit tests are pure — no database, no HTTP. Integration tests use a real `becca_test`
database and are always run in band (`--runInBand`) to avoid connection conflicts.

Each integration test suite calls `clearDatabase()` in `beforeEach` to ensure isolation.

---

## Stopping the Project

```sh
finch compose down           # stop containers
finch compose down -v        # stop and delete database volume (destructive)
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
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/becca"
JWT_SECRET="your_secret_key"
PORT=8000
FRONTEND_URL="http://localhost:8081"
```

Integration tests do not load `backend/.env.test`.
`backend/tests/loadTestEnv.ts` runs before Prisma imports and sets both Prisma
URLs to `TEST_DATABASE_URL` or the guarded local `becca_test` default.

---

## Typical Workflows

### Daily Development

```sh
finch compose up -d
cd frontend && npm run dev   # separate terminal
cd backend && npm run test:unit  # fast feedback loop, no DB needed
finch compose down
```

### After Editing `schema.prisma`

```sh
npx prisma migrate dev --name <description>
# npx prisma generate is usually run automatically
finch compose restart backend
```

### Running Integration Tests

```sh
finch compose up -d db
cd backend && npm run test:integration
```

---

## Finch Compose Reference

```sh
# View running containers
finch ps

# View logs
finch compose logs -f          # all services
finch compose logs -f backend  # backend only

# Restart a service
finch compose restart backend

# Rebuild after Dockerfile changes
finch compose up --build

# Enter a container
finch compose exec backend sh
finch compose exec db psql -U postgres -d becca
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
finch ps                      # verify DB container is running
finch compose logs db         # check DB logs
finch compose restart db
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
finch compose down -v
finch compose up
```

---

## Useful SQL Queries

```sh
finch compose exec db psql -U postgres -d becca
```

```sql
\dt                          -- list all tables
\d "TableName"               -- show table schema
SELECT * FROM "User";
SELECT * FROM "GameRoom";
TRUNCATE "User" CASCADE;     -- delete all users (cascades)
```
