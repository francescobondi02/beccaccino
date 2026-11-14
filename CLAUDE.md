# BECCA — Beccaccino Online

Real-time multiplayer Italian card game (Beccaccino) for 4 players in 2 teams. Playable in browser.

## Architecture

```
backend/    Express 5 + Socket.IO + Prisma (Node 24, TypeScript)
frontend/   React 18 + Vite + Tailwind + shadcn/ui (TypeScript)
mobile/     Expo 58 + React Native + Expo Router (Node 26, TypeScript)
ai/         Python 3.11+ Gymnasium environment for RL self-play training
```

Frontend ↔ Backend: REST API for game actions + WebSocket for real-time state sync.
Database: PostgreSQL 15 via Prisma ORM.
Repo: github.com/francescobondi02/beccaccino (monorepo, no workspaces).
The native mobile app is independent of the website UI; see `mobile/README.md`.
Native login, lobby, waiting room and live table (practice and multiplayer) are
implemented over the same REST/Socket.IO API. Do not replace native
screens with web components or change server rules for presentation concerns.

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
make dev    # everything in Docker: web :8081, API :8000, Metro :8082, bot :8011, Adminer :8080, Postgres :5432
make stop   # make reset wipes the DB and dependency volumes
```

Seeded users `alice`, `bob`, `carol`, `dave` (password `password`). Details: README.md "Develop locally".

## Testing

```bash
make test                               # backend unit + integration (becca_test), frontend Vitest, mobile check
cd frontend && npm run test:e2e         # Playwright 4-browser full game (see DEVELOPMENT.md)
```

## Key Conventions

- Code language: English. UI text: Italian.
- Prisma enums are lowercase strings: `denara`, `asso`, etc.
- Auth: JWT in httpOnly cookie `authToken`. Socket.IO extracts it from handshake cookie header.
- Cookie config: `sameSite: lax`, `secure` in production.
- Turn timer: 60s for card play, 90s for briscola choice. Auto-play on timeout. After 3 timeouts in a row a bot takes the multiplayer seat until `resume-control`.
- Round scores are stored as raw points (`Round.team0Raw`/`team1Raw`, cricca included).
  Sum raw values first, then convert with `toTeamScore` (`domain/game/gameScore.ts`) to real
  points (`raw // 3`) and figures (`raw % 3`). The round caller (`Round.callerId`) and the game
  winner (`GameRoom.winnerTeam`, null for abandoned games) are stored, not derived.
- Socket events are the source of truth for real-time state; REST is for mutations.
- Tests: backend integration uses `becca_test` DB, loaded via `tests/loadTestEnv.ts` before Prisma imports.

## Environment Variables

| Module | Var | Purpose |
|--------|-----|---------|
| backend | DATABASE_URL | Postgres connection string |
| backend | DIRECT_URL | Non-pooled Postgres URL used by Prisma migrations |
| backend | JWT_SECRET | Token signing key |
| backend | PORT | Server port (default 8000) |
| backend | NODE_ENV | `development` / `production` / `test` |
| backend | GAME_WIN_POINTS | Points to win (default 41, lower for testing) |
| backend | TURN_TIMEOUT_SECONDS | Card play timeout (default 60) |
| backend | BRISCOLA_TIMEOUT_SECONDS | Briscola choice timeout (default 90) |
| backend | BOT_SERVICE_URL | Python bot inference service (unset = bots disabled) |
| backend | BOT_THINK_DELAY_MS | Pause before a bot plays (default 1000) |
| frontend | BACKEND_URL | Vite dev proxy target (default `http://localhost:8000`) |

## Deployment

Target stack: Render (backend Docker) + Neon (PostgreSQL, Frankfurt) + Vercel (frontend static).
All auto-deploy from GitHub on push to main.
Backend Dockerfile runs `prisma migrate deploy` on startup (idempotent).
Same-origin `/api` proxy: see [frontend/README.md](frontend/README.md#environment-variables).

## Module Boundaries

- `backend/src/game/transitions/round.ts` — round setup, game start and briscola choice
- `backend/src/game/transitions/cardPlay.ts` — card play, round completion and game completion
- `backend/src/game/runGameAction.ts` — the one game write path (lock, version compare-and-set, re-arm, publish)
- `backend/src/game/liveGame.ts` and `gameState.ts` — load one game; pure per-player state
- `backend/src/domain/game/roundScore.ts` and `gameScore.ts` — pure round and cumulative scoring
- `backend/src/services/multiplayerRooms.ts` and `practiceRooms.ts` — room operations
- `backend/src/services/leaveRoom.ts` — participant departure and preserved game history
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
