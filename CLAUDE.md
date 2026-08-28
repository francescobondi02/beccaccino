# BECCA — Beccaccino Online

Real-time multiplayer Italian card game (Beccaccino) for 4 players in 2 teams. Playable in browser.

## Architecture

```
backend/    Express 5 + Socket.IO + Prisma (Node 24, TypeScript)
frontend/   React 18 + Vite + Tailwind + shadcn/ui (TypeScript)
ai/         Python 3.11+ training, evaluation, search, and bot inference
```

Frontend ↔ Backend: REST API for game actions + WebSocket for real-time state sync.
Database: PostgreSQL 15 via Prisma ORM.
Repo: Git superproject with independent `backend`, `frontend`, and `ai` submodules.

## Game Rules (Beccaccino)

- 4 players, teams: seats {0,2} = team 0, seats {1,3} = team 1
- 40-card Italian deck: 4 suits (denara, coppe, spade, bastoni) × 10 values
- Round 1 caller: whoever holds quattro di denara
- Subsequent rounds: caller rotates +1 seat clockwise
- Caller picks briscola (trump suit), then leads the first trick
- Must follow lead suit if possible; otherwise any card
- Trick winner: highest briscola if any, else highest of lead suit
- Strength order (high→low): tre, due, asso, re, cavallo, fante, sette, sei, cinque, quattro
- Scoring (raw points to avoid fractions): asso=3, tre/due/re/cavallo/fante=1, others=0
- Last trick bonus: +3 raw to winner → total raw per round = 35 (32 card points + 3 bonus)
- Real points = raw // 3, figures = raw % 3
- Game ends when a team's cumulative real points ≥ GAME_WIN_POINTS (default 41)
- Signals: trick leader may declare "striscio" (strong), "busso" (play high), or "volo" (singleton) — visible to all

## Running Locally

```bash
finch compose up -d                       # Postgres :5432, Adminer :8080, backend :8000
cd frontend && npm ci && npm run dev      # frontend :8081
```

Alternatively, run backend outside Docker for hot-reload:
```bash
finch compose up -d db adminer             # Postgres + Adminer only
cd backend && npm ci && npm run dev        # :8000 (generates Prisma + migrates)
```

## Testing

```bash
./scripts/pre-push.sh                    # backend, frontend, and Playwright
cd ai && pytest && ruff check . && ruff format --check .
python -m scripts.gen_bot_fixtures
git diff --exit-code serving/fixtures/
```

## Key Conventions

- Code language: English. UI text: Italian.
- Prisma enums are lowercase strings: `denara`, `asso`, etc.
- Auth: JWT in httpOnly cookie `authToken`. Socket.IO extracts it from handshake cookie header.
- Cookie config: `secure` in production, `sameSite: strict` (same-origin) or `none` (cross-origin deploy).
- Turn timer: 60s for card play, 90s for briscola choice. Auto-play on timeout. Kick after 3 timeouts.
- Points stored per round as real points + figures remainder in SEPARATE columns
  (`Round.team0Points`/`team0Figures`) — `computePoints` returns
  `floor(raw/3)` plus `raw % 3`. To recover raw: `raw = points*3 + figures`. Summing only
  `*Points` silently drops each round's remainder.
- Persisted backend state is authoritative. REST owns mutations; Socket.IO
  publishes committed changes and presence/chat events.
- Tests: backend integration uses `becca_test` DB, loaded via `tests/loadTestEnv.ts` before Prisma imports.
- Test auth bypass requires `NODE_ENV=test`, `ALLOW_TEST_AUTH_BYPASS=true`, and
  both `x-test-user-id` and `x-test-username` when no cookie is present.

## Environment Variables

| Module | Var | Purpose |
|--------|-----|---------|
| backend | DATABASE_URL | Postgres connection string |
| backend | DIRECT_URL | Non-pooled Postgres URL used by Prisma migrations |
| backend | JWT_SECRET | Token signing key |
| backend | PORT | Server port (default 8000) |
| backend | NODE_ENV | `development` / `production` / `test` |
| backend | FRONTEND_URL | CORS origin (Vercel URL in prod) |
| backend | ANNOTATION_ACCESS_CODE | Private shared code granting expert access to authenticated accounts |
| backend | GAME_WIN_POINTS | Points to win (default 41, lower for testing) |
| backend | TURN_TIMEOUT_SECONDS | Card play timeout (default 60) |
| backend | BRISCOLA_TIMEOUT_SECONDS | Briscola choice timeout (default 90) |
| backend | SENTRY_DSN | Sentry error tracking DSN (optional, disables if unset) |
| backend | BOT_SERVICE_URL | Python bot inference service (unset = bots disabled) |
| backend | BOT_SERVICE_TOKEN | Shared bearer token for the bot service |
| backend | BOT_THINK_DELAY_MS | Pause before a bot plays (default 1000) |
| frontend | VITE_API_URL | Backend REST base URL (`/api`) |
| frontend | VITE_SOCKET_URL | Backend WebSocket URL |
| frontend | VITE_SENTRY_DSN | Sentry error tracking DSN (optional, disables if unset) |

## Deployment

Target stack: Render (backend and AI Docker) + Neon (PostgreSQL, Frankfurt) +
Vercel (frontend static). Each submodule runs CI on `main`; only a successful
push CI run triggers deployment of that exact commit.
Backend Dockerfile runs `prisma migrate deploy` on startup (idempotent).
Cross-origin deploy requires cookie `sameSite: 'none'` + `secure: true`.

## Module Boundaries

- `backend/src/controllers/` adapts HTTP; `services/` coordinates operations;
  `game/transitions/` owns atomic writes; `game/snapshots/` owns side-effect-free
  reads; `domain/game/` owns pure rules; `runtime/` owns timers, bots, recovery,
  timeout policy, and best-effort event publication.
- `frontend/src/pages/` adapts routes and composes views; `hooks/` coordinates
  REST and Socket.IO; `game/` and `rooms/` own pure reducers/selectors;
  `components/` renders focused views; `lib/api.ts` is the REST boundary.
- `ai/becca_env/` owns AI simulation rules and observations; `training/`,
  `data/`, `evaluation/`, and `inference/` own reusable workflows;
  `serving/` adapts backend state and serves validated bot moves.
- The TypeScript backend remains authoritative for persisted online games and
  accepted moves. Cross-language rule vectors, generated fixtures, and the
  runtime legal-card check keep the AI implementation compatible.

See each submodule's `CLAUDE.md` and development or architecture guide for the
complete ownership map.
