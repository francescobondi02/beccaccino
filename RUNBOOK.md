# BECCA — Operations runbook

How to deploy, configure and repair production. Local development is in
[README.md](./README.md).

## Services

| Part | Host | Address |
| --- | --- | --- |
| Website | Vercel, root directory `frontend/` | https://beccaccino-client.vercel.app |
| Backend | Render, Docker, root directory `backend/` | https://beccaccino-server.onrender.com |
| Database | Neon PostgreSQL | Neon console |
| Bot service | Render, Docker, from `ai/render.yaml` (free plan) | see [ai/docs/DEPLOYMENT.md](./ai/docs/DEPLOYMENT.md) |

The browser talks only to the Vercel origin. `frontend/vercel.json` forwards
`/api/*` and Socket.IO polling to the Render backend, and
`frontend/api/socket-proxy.ts` bridges WebSocket upgrades. Both hard-code the
Render URL. The native app calls the Render URL directly
(`mobile/src/lib/backend.ts`).

The backend runs as one instance. Room locks and turn timers live in memory;
do not scale it out.

## Deploy

Work lands on `develop`. A PR from `develop` to `main` releases it: Render
builds `backend/Dockerfile` and Vercel builds `frontend/` on every push to
`main`. The bot service is deployed by hand.

- The backend container runs `npx prisma migrate deploy && node dist/index.js`.
  A failed migration stops the new container; Render keeps the old one.
- The web app imports types from `backend/src/contract/`, so the Vercel project
  must include files outside its root directory in the build.
- Deploy the backend before the website when the contract changes. The mobile
  app must come from the same commit as the backend.
- Check after a deploy: `curl https://beccaccino-server.onrender.com/ready`
  returns `{"status":"ready"}`, then log in and play a few tricks of a practice
  game on the website.

## Environment variables

Render, backend:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Neon pooled URL (host contains `-pooler`) with `?sslmode=require&connection_limit=5&pool_timeout=10` |
| `DIRECT_URL` | Neon direct URL of the same database. Prisma fails if it is unset. |
| `JWT_SECRET` | Long random string. Changing it logs everyone out. |
| `BOT_SERVICE_URL`, `BOT_SERVICE_TOKEN` | Bot service URL and its shared secret. Without them, practice games cannot start. |
| `GAME_WIN_POINTS` | Optional, default 41. Read at startup; applies to every game after a restart. |
| `TURN_TIMEOUT_SECONDS`, `BRISCOLA_TIMEOUT_SECONDS` | Optional, defaults 60 and 90. |
| `BOT_THINK_DELAY_MS` | Optional, default 1000. |
| `LOG_LEVEL` | Optional, default `info`. Use `debug` for more detail. |
| `RUNTIME_RECONCILE_INTERVAL_MS` | Optional, default 30000. |

`NODE_ENV=production` is set by the Dockerfile. Render sets `PORT`.

Render, bot service: `BOT_SERVICE_TOKEN`, the same value as the backend.

Vercel: no variables are needed.

Nothing reads `FRONTEND_URL`, `ANNOTATION_ACCESS_CODE`, `VITE_API_URL`,
`VITE_SOCKET_URL` or any `SENTRY_*` variable. Delete them if they still exist.

## Migrations

Migrations live in `backend/prisma/migrations/` and apply on every backend
start. Create them locally with `prisma migrate dev` (see
[backend/README.md](./backend/README.md#database)). CI applies them to an empty
database and fails if they do not match `schema.prisma`.

Run SQL by hand only with `DIRECT_URL`, never the pooled URL.

## Backup and restore

Back up before every schema change. Use `pg_dump` of the same major version as
Neon or newer:

```sh
pg_dump "$DIRECT_URL" --format=custom --file=becca-YYYY-MM-DD.dump
```

The dump contains password hashes. Keep it private and outside the repository.

To restore over a schema that has changed since the dump, empty the schema
first:

```sh
psql "$DIRECT_URL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
pg_restore --no-owner --dbname "$DIRECT_URL" becca-YYYY-MM-DD.dump
```

Then deploy the commit that matches the dump. Neon can also restore a branch to
a point in time, within the plan's history window.

## Release checkpoint: develop to main with a database wipe

The first release of the monorepo replaces the old migration history with one
baseline, so the production database is wiped once. There are no real users
yet. The owner runs these steps in order.

1. Back up the Neon database (see above).
2. Wipe the schema:
   `psql "$DIRECT_URL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'`.
   The running old backend fails until step 3 finishes.
3. Render backend. Open the service settings and set:
   - Repository: `francescobondi02/beccaccino`, branch `main`.
   - Root Directory: `backend`.
   - Dockerfile Path: `./Dockerfile`. Docker Build Context: `.`.
     Both paths are relative to `backend/`.
   - Build Filters, Included Paths: `backend/**`. Changes in other folders
     then do not redeploy the backend.
   - Environment: set a new `JWT_SECRET`. Delete `FRONTEND_URL`,
     `ANNOTATION_ACCESS_CODE` and any `SENTRY_*` variables.

   Save all of this at once, then deploy. The start runs
   `prisma migrate deploy`, which creates the baseline. Check that `/ready`
   returns `{"status":"ready"}`.
4. Vercel website. Open the project settings and set:
   - Git: this repository, production branch `main`.
   - Root Directory: `frontend`.
   - Keep "Include files outside the root directory in the Build Step" on.
     The website imports types from `backend/src/contract/`.
   - Ignored Build Step:
     `git diff --quiet HEAD^ HEAD -- . ../backend/src/contract`.
     Vercel then skips the build when nothing the website uses has changed.
   - Environment: delete `VITE_API_URL`, `VITE_SOCKET_URL` and any `SENTRY_*`
     variables.

   Then deploy.
5. Render bot service (`becca-ai`). Open the service settings and set:
   - Repository: this repository, branch `main`.
   - Root Directory: `ai`.
   - Dockerfile Path: `./Dockerfile`. Docker Build Context: `.`.
   - Build Filters, Included Paths: `ai/**`.
   - If the service comes from a Blueprint, set the Blueprint path to
     `ai/render.yaml`.
   - Keep `BOT_SERVICE_TOKEN`. It must match the backend.

   Then deploy, or leave it on manual deploys.
6. Users register again. The 3 bot users are created on demand.
7. Smoke test: register, play a practice game on the website, log in on the
   phone app.
8. Disconnect or archive the old frontend and backend repositories in Render
   and Vercel. Otherwise a push there still deploys the old code.

Rotate `JWT_SECRET` with the first deploy on the wiped database, not later.
The backend accepts a token whose user id exists. After the wipe, ids start
again from 1, so an old token signed with the old secret could act as a new
user.

Rollback: restore the backup as above, then redeploy the previous commit.

## Incidents

Start with Render logs, then Neon monitoring, then Vercel logs. Check
`/health` (the process is up) and `/ready` (the database answers and runtime
recovery finished).

Backend logs are JSON (pino). Every request has an id, also returned in the
`x-request-id` header. Useful searches:

| To find | Search for |
| --- | --- |
| Errors | `"level":50` |
| One game | `"roomCode":"ABCD23"` |
| One user | `"userId":42` |
| Moves and results | `card_played`, `round_ended`, `game_finished` |
| Server-chosen moves | `bot_fallback_to_autoplay`, `turn_execution_failed` |
| Timer repair | `turn_runtime_recovered`, `active_runtime_reconcile_failed`, `room_runtime_recovery_failed` |
| Failed pushes | `game_publish_failed` |
| Practice | `practice_game_paused`, `practice_game_resumed`, `player_abandoned_game`, `practice_rooms_swept` |
| Restarts | `server_started`, `shutdown_initiated` |
| Crashes | `uncaught_exception`, `unhandled_rejection` |
| Load, every 60 s | `ops_snapshot` |

### A game is stuck

1. Get the room code and search the logs for it.
2. Turn deadlines are stored (`GameRoom.turnStartedAt`). After a restart, startup
   recovery re-arms every live game before `/ready` passes. The reconciler
   repeats this every 30 s.
3. If `room_runtime_recovery_failed` repeats for one room, read its error. A
   paused practice game is not stuck; its player resumes it.

### Backend down or not ready

1. Render events: a failed deploy, a crash, out of memory? A failed
   `prisma migrate deploy` shows in the first log lines.
2. `/ready` returns 503 with `database unreachable`: check Neon.
   `runtime recovery incomplete`: search `room_runtime_recovery_failed`.
3. Too many connections: check that `DATABASE_URL` uses the pooler host and
   `connection_limit=5`, then restart the service.

### Practice games do not start

Room creation first waits up to 75 s for the bot service's `/ready`. A free
Render service sleeps and takes about a minute to wake. If it fails, check the
bot service logs and that both services have the same `BOT_SERVICE_TOKEN`.

### Known limits

- The leaderboard is cached for 60 s.
- The website's socket reconnects every 300 s, when Vercel ends the proxy
  function. Clients refetch the state.
- Web login rate limits use Vercel's address, so they are shared by all web
  users.
