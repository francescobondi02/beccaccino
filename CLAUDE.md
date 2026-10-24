# BECCA — Beccaccino Online

Real-time multiplayer Italian card game (Beccaccino) for 4 players in 2 teams. Playable in browser.

## Architecture

```
backend/    Express 5 + Socket.IO + Prisma (Node 24, TypeScript)
frontend/   React 18 + Vite + Tailwind + shadcn/ui (TypeScript)
ai/         Python 3.11+ Gymnasium environment for RL self-play training
```

Frontend ↔ Backend: REST API for game actions + WebSocket for real-time state sync.
Database: PostgreSQL 15 via Prisma ORM.
Repo: github.com/francescobondi02/beccaccino (monorepo, no workspaces).

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
docker compose up -d              # Postgres on :5432, Adminer on :8080, Backend on :8000
cd frontend && npm install && npm run dev   # :8081
```

Alternatively, run backend outside Docker for hot-reload:
```bash
docker compose up -d db adminer   # Postgres + Adminer only
cd backend && npm install && npm run dev    # :8000 (auto-runs prisma generate + migrate)
```

## Testing

```bash
cd backend && npm run test:unit         # Pure logic, no DB
cd backend && npm run test:integration  # Needs docker postgres + becca_test DB
cd frontend && npm test                 # Vitest unit tests
cd frontend && npm run test:e2e         # Playwright 4-browser full game (needs backend+frontend running)
```

## Key Conventions

- Code language: English. UI text: Italian.
- Prisma enums are lowercase strings: `denara`, `asso`, etc.
- Auth: JWT in httpOnly cookie `authToken`. Socket.IO extracts it from handshake cookie header.
- Cookie config: `secure` in production, `sameSite: strict` (same-origin) or `none` (cross-origin deploy).
- Turn timer: 60s for card play, 90s for briscola choice. Auto-play on timeout. Kick after 3 timeouts.
- Points stored per round as real points + figures remainder in SEPARATE columns
  (`Round.team0Points`/`team0Figures`, `schema.prisma:112-115`) — `computeRoundScore` returns
  `floor(raw/3)` plus `raw % 3`. To recover raw: `raw = points*3 + figures`. Summing only
  `*Points` silently drops each round's remainder.
- Socket events are the source of truth for real-time state; REST is for mutations.
- Tests: backend integration uses `becca_test` DB, loaded via `tests/loadTestEnv.ts` before Prisma imports.
- Test auth bypass: `NODE_ENV=test` skips JWT, allows `x-test-user-id` header.

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
| backend | BOT_THINK_DELAY_MS | Pause before a bot plays (default 1000) |
| frontend | VITE_API_URL | Backend REST base URL (`/api`) |
| frontend | VITE_SOCKET_URL | Backend WebSocket URL |
| frontend | VITE_SENTRY_DSN | Sentry error tracking DSN (optional, disables if unset) |

## Deployment

Target stack: Render (backend Docker) + Neon (PostgreSQL, Frankfurt) + Vercel (frontend static).
All auto-deploy from GitHub on push to main.
Backend Dockerfile runs `prisma migrate deploy` on startup (idempotent).
Cross-origin deploy requires cookie `sameSite: 'none'` + `secure: true`.

## Module Boundaries

- `backend/src/game/transitions/round.ts` — round setup, game start and briscola choice
- `backend/src/game/transitions/cardPlay.ts` — card play, round completion and game completion
- `backend/src/game/turn.ts` — shared turn phase and persisted turn identity
- `backend/src/domain/game/roundScore.ts` and `gameScore.ts` — pure round and cumulative scoring
- `backend/src/services/multiplayerRooms.ts` and `practiceRooms.ts` — room operations
- `backend/src/services/leaveRoom.ts` — participant departure and preserved game history
- `backend/src/services/playableCards.ts` — read-only query for legal moves
- `backend/src/runtime/` — timers, timeout penalties, bot turns and recovery
- `backend/src/services/botUsers.ts` — bot accounts (fixed pool of 3 users) and difficulty tiers
- `backend/src/services/botState.ts` — serializes a game into the bot service's wire format
- `backend/src/services/botClient.ts` — HTTP client for the Python `/act` endpoint
- `backend/src/sockets/room.ts` — lobby/room presence and chat; game mutations use REST
- `frontend/src/sockets/socketClient.ts` — singleton socket with reconnection (Infinity attempts)
- `frontend/src/sockets/lobbyHandlers.ts` — lobby socket event handlers (room CRUD, player join/leave)
- `frontend/src/sockets/roomHandlers.ts` — room socket event handlers (team choice, ready, game start)
- `frontend/src/pages/GameTable.tsx` — main game UI (~1100 lines, manages full game state)
- `frontend/src/pages/GameRoom.tsx` — pre-game room (team selection, ready state)
- `frontend/src/pages/Leaderboard.tsx` — player rankings
- `frontend/src/pages/Profile.tsx` — user profile page
- `ai/becca_env/game.py` — pure Python game engine (mirrors backend rules exactly)
- `ai/becca_env/observation.py` — state→tensor encoding for neural network input
- `ai/CLAUDE.md` — detailed AI module docs (training, serving, evaluation, network architecture)
