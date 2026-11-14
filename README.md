# BECCA (Beccaccino Online) Blueprint

## System Overview

BECCA is a real-time, four-player Italian card game (Beccaccino) for two teams.
The repository is a monorepo without npm workspaces. All four modules (`ai`,
`backend`, `frontend`, `mobile`) live in this repository.

- `backend` is the authority for game state. It exposes REST mutations under
  `/api` and Socket.IO events for real-time updates, and stores data in
  PostgreSQL through Prisma.
- `frontend` (web) and `mobile` (native Expo app) are clients of the same
  backend. They send mutations over REST and use socket events to refresh state.
- `ai` provides the Python game engine used for training and the FastAPI bot
  service that the backend calls for bot moves.

## Develop locally

The host needs only Docker and make. Everything else, including Node, Python
and Expo Metro, runs in containers with hot reload. Dependencies live in named
volumes, never in host `node_modules`.

```sh
make dev     # build, start detached, wait until healthy, print URLs and Expo QR
make logs    # follow the logs
make test    # backend unit + integration (becca_test), frontend Vitest, mobile check
make stop    # stop, keep data
make reset   # delete the database and dependency volumes, then start fresh
make qr      # print the Expo Go URL and QR code again
```

After pulling Phase 3a, run `make reset` (drops the local databases).

| Service | URL |
| --- | --- |
| Web | http://localhost:8081 |
| API | http://localhost:8000 (also `http://<LAN IP>:8000`) |
| Expo Metro | `exp://<LAN IP>:8082` |
| Bot | http://localhost:8011/health |
| Adminer | http://localhost:8080 (server `db`, user and password `postgres`) |
| PostgreSQL | localhost:5432, databases `becca` and `becca_test` |

- Accounts: `alice`, `bob`, `carol`, `dave`, password `password`, seeded by
  `backend/scripts/seedDevUsers.ts` (dev-only, never in the production image).
- Phone: install Expo Go, join the Mac's Wi-Fi and scan the QR from `make dev`
  or `make qr`. Wrong IP? `make dev LAN_IP=192.168.1.20`.
- Configuration: no `.env` is required. `docker-compose.yml` sets dev-only,
  non-secret defaults for `JWT_SECRET` and `BOT_SERVICE_TOKEN`. An optional root
  `.env` can override them. On restricted networks the Makefile reuses the
  host's npm mirror (`~/.npmrc` `registry=`) and pip mirror (`pip3 config`)
  inside the containers. An optional
  `backend/.env` can still set other backend variables such as `GAME_WIN_POINTS`.
- Migrations run on every backend start for `becca`; `make test` migrates
  `becca_test` itself. `init-db.sql` creates both databases when the `db_data`
  volume is first created.
- The Python training environment in `ai/` is separate; see
  [ai/README.md](./ai/README.md).

## Subdirectories & System Boundaries

- ai: [./ai/README.md](./ai/README.md) - Python 3.11+ Beccaccino engine
  (`becca_env`), PPO self-play training, evaluation, PIMC inference and the
  FastAPI bot service (`serving`: `POST /act`, `GET /ready`, `/tiers`,
  `/health`, `/version`).
- backend: [./backend/README.md](./backend/README.md) - Node 24 TypeScript
  server with Express 5, Socket.IO and Prisma. REST routes are under
  `/api/users`, `/api/rooms` and `/api/games`. It owns turn
  timers, bot turns, recovery and scoring.
- frontend: [./frontend/README.md](./frontend/README.md) - React 18 and Vite
  web client, plus a Vercel function that proxies WebSockets
  (`api/socket-proxy.ts`, `server/socketProxy.ts`).
- mobile: [./mobile/README.md](./mobile/README.md) - Expo Router native client
  (iOS and Android) with a token session, lobby, waiting room and live table.

## Global Invariants

- The server is authoritative. Clients send only server-legal cards
  (`playableCards` in the game state) and render the full `game_state` the
  server pushes; room and lobby events are signals to reload. Clients do not
  run a second rules engine. Shared types live in `backend/src/contract/`.
- Game rules exist twice and must stay identical: TypeScript in
  `backend/src/domain/game/` (`computeRoundScore` in `roundScore.ts`,
  `trickWinner.ts`, `legalCards.ts`, `detectCricca.ts`, `turnOrder.ts`) and
  Python in `ai/becca_env/` (`rules.py:compute_round_scores`,
  `rules.py:determine_hand_winner`, `game.py:BeccaGame`). Seats {0,2} are
  team 0 and seats {1,3} are team 1 (`ai/becca_env/game.py:TEAM_OF_SEAT`).
- Round scores are stored as raw points (`Round.team0Raw`/`team1Raw` in
  `backend/prisma/schema.prisma`). Real points are `raw // 3`, figures `raw % 3`.
- Card suits and values cross the backend-to-bot boundary as the lowercase
  Prisma enum strings (`denara`, `asso`, ...), never as indices
  (`ai/serving/state_adapter.py:_card`).
- The backend calls the bot service with `Authorization: Bearer` and
  `BOT_SERVICE_TOKEN` (`backend/src/services/botClient.ts`). The bot service
  refuses `/act` and `/ready` without the same token
  (`ai/serving/app.py:_require_bot_token`).
- Web authentication uses the `authToken` httpOnly cookie
  (same-origin requests from `frontend/src/lib/api.ts` send it). Native
  authentication uses `POST /api/users/native/login` (or `/native/register`) and a bearer token
  (`mobile/src/lib/session.ts` sends `credentials: 'omit'`;
  `mobile/src/lib/socket.ts` sends `auth.token`). Both paths are checked by
  `verifyActiveSession` (`backend/src/auth/activeSession.ts`).
- Prisma migrations in `backend/prisma/migrations/` are immutable history.
  Add new migrations; never edit applied ones.

## Global Side Effects

- PostgreSQL 15: databases `becca` (development) and `becca_test`
  (integration tests).
- Bot inference: the backend calls the Python service at `BOT_SERVICE_URL`
  (`docker-compose.yml` sets `http://bot:8011`).
- Production: backend on Render (`https://beccaccino-server.onrender.com`, the
  default origin of `mobile/src/lib/backend.ts`), web frontend on Vercel.
- `make reset` deletes the local database volume.
- CI: `.github/workflows/<module>.yml`, path-filtered.

## Operator Documents

- [DEVELOPMENT.md](./DEVELOPMENT.md): local development workflow.
- [RUNBOOK.md](./RUNBOOK.md): operational procedures.
- [CLAUDE.md](./CLAUDE.md): agent context, rules and module boundaries.

## System Verification

- Run: `make test` (backend, frontend and mobile, inside the containers)
- Run: `cd ai && pytest`
