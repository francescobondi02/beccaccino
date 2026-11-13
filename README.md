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

## Local Interface & Invariants

The root folder contains local development tooling only.

- `setup.sh`: starts the `db` service with `docker compose --env-file backend/.env up db -d --wait`,
  installs backend dependencies, runs `npx prisma generate` and
  `npx prisma migrate deploy` on `becca`, pushes the schema to `becca_test` with
  `npx prisma db push --skip-generate`, then installs frontend dependencies.
  - Invariant: it exports `NODE_ENV=development` and a localhost `DATABASE_URL`
    and `DIRECT_URL` first, so an inherited production URL never reaches the
    migrations.
- `cleanup.sh`: runs `docker compose down -v` (removes containers and the
  database volume), then deletes `backend/node_modules`,
  `frontend/node_modules` and `mobile/node_modules`.
- `setup.sh` prepares only `backend` and `frontend`. It does not install
  `mobile/` (see [mobile/README.md](./mobile/README.md)) or the Python `ai/`
  environment (see [ai/README.md](./ai/README.md)).
- The `backend` compose service does not set `JWT_SECRET`; the backend loads it
  from the mounted `backend/.env` through `process.loadEnvFile()`
  (`backend/src/index.ts`), and exits at startup when it is missing.
- `init-db.sql`: `CREATE DATABASE becca;` and `CREATE DATABASE becca_test;`.
  `docker-compose.yml` mounts it into `/docker-entrypoint-initdb.d/`, so it runs
  only when the `db_data` volume is first created.
- `docker-compose.yml`: services `db` (postgres:15, port 5432), `adminer`
  (port 8080), `backend` (port 8000, waits for healthy `db` and `bot`), `bot`
  (`uvicorn serving.app:app`, bound to `127.0.0.1:8011`), and `frontend`
  (port 8081).
- `Makefile`: `make dev` and `make stop` run `docker compose --env-file backend/.env` up/down.

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
  (`GET /api/games/playable-cards/:roomCode`) and treat socket events as
  signals to reload state. They do not run a second rules engine.
- Game rules exist twice and must stay identical: TypeScript in
  `backend/src/domain/game/` (`computeRoundScore` in `roundScore.ts`,
  `trickWinner.ts`, `legalCards.ts`, `detectCricca.ts`, `turnOrder.ts`) and
  Python in `ai/becca_env/` (`rules.py:compute_round_scores`,
  `rules.py:determine_hand_winner`, `game.py:BeccaGame`). Seats {0,2} are
  team 0 and seats {1,3} are team 1 (`ai/becca_env/game.py:TEAM_OF_SEAT`).
- Round scores are stored as separate points and figures columns
  (`backend/prisma/schema.prisma:Round`). Recover raw points with
  `raw = points * 3 + figures`.
- Card suits and values cross the backend-to-bot boundary as the lowercase
  Prisma enum strings (`denara`, `asso`, ...), never as indices
  (`ai/serving/state_adapter.py:_card`).
- The backend calls the bot service with `Authorization: Bearer` and
  `BOT_SERVICE_TOKEN` (`backend/src/services/botClient.ts`). The bot service
  refuses `/act` and `/ready` without the same token
  (`ai/serving/app.py:_require_bot_token`).
- Web authentication uses the `authToken` httpOnly cookie
  (same-origin requests from `frontend/src/lib/api.ts` send it). Native
  authentication uses `POST /api/users/native/login` and a bearer token
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
- `cleanup.sh` deletes the local database volume (`docker compose down -v`).
- CI: `.github/workflows/<module>.yml`, path-filtered.

## Operator Documents

- [DEVELOPMENT.md](./DEVELOPMENT.md): local development workflow.
- [RUNBOOK.md](./RUNBOOK.md): operational procedures.
- [CLAUDE.md](./CLAUDE.md): agent context, rules and module boundaries.

## System Verification

There is no root test target. Run each module's suite:

- Run: `cd backend && npm run test:unit` (no database), and
  `cd backend && npm run test:integration` (needs Docker Postgres with `becca_test`).
- Run: `cd frontend && npm test`
- Run: `cd mobile && npm run check` (typecheck, lint and Jest)
- Run: `cd ai && pytest`
