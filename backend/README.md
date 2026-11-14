# Backend

Node 24, TypeScript, Express 5, Socket.IO and Prisma on PostgreSQL. The backend
owns every game: it checks turns and moves, stores the state, runs the turn
timers and asks the Python bot service for bot moves. The layers and the game
write path are in the root [CLAUDE.md](../CLAUDE.md).

## Run

Run `make dev` from the root. The `backend` container installs packages, runs
`prisma generate` and `prisma migrate deploy`, seeds the dev users and starts
the server with hot reload on port 8000.

```sh
docker compose exec backend npm run typecheck
docker compose exec backend npm run build
docker compose exec backend npm run test:unit
```

## Test

`make test` runs the whole Jest suite. Integration tests need the local
`becca_test` database on `localhost`, so they run in a throwaway container that
shares the database container's network. To run one file:

```sh
docker run --rm --network container:becca-db --volumes-from becca-backend \
  --volume "$PWD/ai:/ai:ro" --workdir /app node:24-alpine \
  sh -c "npm run db:test:prepare && npx jest tests/integration/rooms.test.ts"
```

- `tests/loadTestEnv.ts` runs before any import and points Prisma at
  `becca_test`. It refuses any other host or database.
- `npm run db:test:prepare` applies migrations to `becca_test` only.
- Unit tests (`tests/unit/`) need no database. Integration tests
  (`tests/integration/`) run one at a time with Supertest and real Socket.IO
  clients. Helpers: `tests/helpers/database.ts` (reset),
  `serverHarness.ts` (test server, real tokens), `gameDriver.ts` (game setup).
- `botStateFixtures.test.ts` reads `../ai/serving/fixtures/bot_states.json`.
- `botLive.test.ts` calls a real bot service and is skipped unless
  `RUN_LIVE_BOT_TESTS=true`, `BOT_SERVICE_URL` and `BOT_SERVICE_TOKEN` are set.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | `prisma generate`, `prisma migrate deploy`, then the server with hot reload |
| `npm run dev:e2e` | Same against `becca_test` with `NODE_ENV=test`, for Playwright |
| `npm run build` | `prisma generate` and `tsc` into `dist/` |
| `npm start` | Run `dist/index.js` |
| `npm run typecheck` | Type check without output |
| `npm run migrate` | `prisma migrate deploy` |
| `npm run seed:dev` | Create alice, bob, carol and dave; refuses anything but the local dev database |
| `npm test` | All Jest tests, one at a time |
| `npm run test:unit` / `test:integration` | One Jest project |
| `npm run db:test:prepare` | Migrate the local `becca_test` database |

## Database

The schema is `prisma/schema.prisma`; migrations are in `prisma/migrations/`.
Prisma needs both `DATABASE_URL` and `DIRECT_URL`; it fails if either is unset.
To change the schema, edit it and create a migration in the container:

```sh
docker compose exec backend npx prisma migrate dev --name <name>
```

Check that the migrations match the schema, as CI does:

```sh
docker compose exec backend sh -c 'npx prisma migrate diff \
  --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code'
```

## API

All routes except register, login, leaderboard and the probes need a session:
the `authToken` cookie (website) or `Authorization: Bearer <token>` (native app).

| Method | Path | What it does |
| --- | --- | --- |
| POST | `/api/users/register`, `/api/users/login` | Create an account or log in; sets the cookie |
| POST | `/api/users/native/register`, `/api/users/native/login` | Same, returns `{ user, token }` and sets no cookie |
| POST | `/api/users/logout` | Clear the cookie |
| GET, PATCH, DELETE | `/api/users/me` | Read, rename or anonymize the account |
| GET | `/api/users/me/stats` | Player statistics |
| GET | `/api/users/leaderboard` | Multiplayer leaderboard (public, cached 60 s) |
| POST | `/api/rooms` | Create a multiplayer room |
| POST | `/api/rooms/practice` | Start a practice game against 3 bots |
| GET | `/api/rooms/available` | Open rooms and the caller's active games |
| GET | `/api/rooms/:roomCode` | Room details |
| POST | `/api/rooms/:roomCode/join`, `choose-team`, `ready` | Waiting-room actions |
| POST | `/api/rooms/:roomCode/bots` | Set the bot tier that replaces players who time out or leave |
| POST | `/api/rooms/:roomCode/pause`, `resume` | Pause or resume a practice game |
| POST | `/api/rooms/:roomCode/leave` | Leave a room or abandon a game |
| POST | `/api/rooms/:roomCode/resume-control` | Take the seat back from a bot |
| GET | `/api/games/:roomCode/state` | The caller's game state; never starts a timer |
| POST | `/api/games/:roomCode/briscola`, `cards` | Choose the briscola or play a card; returns the new state |
| GET | `/health`, `/ready` | Liveness; readiness (database and runtime recovery) |

Socket.IO pushes `game_state` (full state for one player), `room_changed`,
`lobby_changed`, presence and chat. Socket messages never change a game.

## Bot service

Practice-room creation first calls the bot service's `/ready` for the chosen
tier, and allows 75 s so a sleeping Render service can wake. Each `/act` call
then has 5 s. If a call fails, the server plays a legal card for the bot.
