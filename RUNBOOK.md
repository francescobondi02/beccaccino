# BECCA — Operations Runbook

Quick reference for diagnosing and fixing production issues during beta. When something breaks at 11 PM, start here.

## Architecture at a glance

| Layer    | Hosted on | URL / dashboard |
| -------- | --------- | --------------- |
| Frontend | Vercel | https://beccaccino-client.vercel.app / Vercel BECCA project |
| Backend | Render | https://beccaccino-server.onrender.com / `becca-backend` logs |
| Database | Neon | https://console.neon.tech → BECCA project |
| Errors | Sentry | https://sentry.io → backend + frontend projects |

## First five minutes of any incident

1. Open Sentry — is there a fresh error spike? Filter by `environment:production` and the last 30 minutes.
2. Open Render → backend → Logs — search for `level:error` (or `"err"` in JSON logs).
3. Open Sentry's frontend project for browser errors; use Vercel logs for build/deploy failures. Session Replay is disabled.
4. Check Neon → Monitoring — connection count, slow queries, CPU.
5. Check `/health` for a live process, then `/ready` for DB connectivity and completed game recovery. Expected responses: `{"status":"ok"}` and `{"status":"ready"}`.

## Production database

Keep one production database on Neon. Local development and CI use separate
databases; never run tests, seeds, `prisma db push`, or `migrate reset` against
production.

- `backend/prisma/schema.prisma` defines the tables. Keep applied migrations
  unchanged; add a migration for each schema change.
- The backend shares one Prisma client (`backend/src/db.ts`). On Render, use
  the pooled host for `DATABASE_URL` and the direct host for `DIRECT_URL`
  (migrations). Both must target the same production database and branch.
- The production Docker command runs `prisma migrate deploy` before starting the
  server. CI applies migrations to its test database, checks schema alignment,
  and starts the production image.

### What we keep

| Data | Current policy |
| ---- | -------------- |
| Multiplayer games | Keep finished games: profiles and leaderboard use their history. Empty waiting rooms are deleted when the last player leaves. |
| Practice games | Every 10 minutes, retire finished rooms and rooms inactive for at least 24 hours. Archive games with genuine human actions in `PracticeMatch` before deleting live rows, in one transaction. |
| Practice archives and expert annotations | Keep for now. No automatic expiry. Review size before adding retention or deleting useful training data. |
| Accounts | Account deletion marks the account deleted and preserves game history. |

Do not delete tables or game rows just because they look old. Identify their
owner and dependencies first. No extra databases, archive services, or cleanup
jobs are needed for the current beta.

### Backups: manual, bounded, free

**Status:** this is the chosen procedure, not a verified Neon configuration.
The console settings, existing snapshot, storage usage, and restore test still
need an owner check. No backup schedule or production change was made.

Provider limits checked on 2026-10-25: Neon Free includes 1 GB of database storage
per project, one manual snapshot, and instant restore up to 6 hours or 1 GB of
changes, whichever limit is reached first. Native scheduled snapshots require a
paid plan. Check the console before relying on these limits.

1. In Neon, select the production project and branch. Check Usage and the
   **Backup & restore** history window.
2. Keep one manual snapshot. Review its date monthly and before migrations,
   imports, or deletions. Refresh it when useful data has changed, not on every
   deploy. Do not automatically delete the only snapshot to free its slot;
   replacing it needs an explicit decision and an available recovery path.
3. After creating a snapshot, test **Restore > Multi-step restore** into a
   separate temporary branch. Leave production connections unchanged. Check the
   schema, migration history, and expected row counts. Record the snapshot date
   and successful test date in the team's private operations notes.
4. Delete only the temporary test branch after verification. Do not accumulate
   backup branches. A monthly Usage review is enough for this inactive beta.

Before a real recovery, pause writes, inspect the restore point in a separate
branch, and confirm the expected data. Switching production to older data can
discard newer changes; it requires explicit approval. Keep the current branch
until recovery is verified.

No external dumps, GitHub artifacts, paid schedules, or custom backup code for
now. A snapshot on Neon does not protect against losing the whole Neon account
or project.

Sources: [Neon plans](https://neon.com/pricing) and
[backup and restore](https://neon.com/docs/guides/backup-restore).

### Idle compute

The runtime reconciler queries the DB every 30 seconds by default; ops metrics
query every 60 seconds. These reads prevent Neon's five-minute idle suspension
while the backend is running, even without players. Storage and compute are
different quotas. Check both in Usage; no polling settings were changed here.

## Logs — what to look for

Backend logs are structured JSON (pino). Useful queries inside Render's log search:

| Want to find...                       | Search for                                                   |
| ------------------------------------- | ------------------------------------------------------------ |
| All errors                            | `"level":50` or `"err"`                                      |
| What happened in a specific game      | `"roomCode":"ABCD"`                                          |
| What a specific user did              | `"userId":42`                                                |
| Card plays (the source of most bugs)  | `"card_played"`                                              |
| Round/game outcomes                   | `"round_ended"` / `"game_finished"`                          |
| Periodic ops metrics                  | `"ops_snapshot"` (active games, sockets, memory, every 60 s) |
| Auto-play / runtime recovery           | `"auto_play_failed"`, `"active_runtime_recovery_complete"`, `"active_runtime_reconcile_complete"` |
| Recent restarts                       | `"server_started"` / `"shutdown_initiated"`                  |
| Any unhandled error                   | `"uncaught_exception"` / `"unhandled_rejection"`             |

Every HTTP request gets a `req.id` (also returned in the `x-request-id` response header) so you can correlate a frontend network failure with backend logs.

## Sentry — minimal production error capture

**Activation requires configuration and deployment:** set the Node project's
`SENTRY_DSN` on Render (`NODE_ENV=production`) and the React project's
`VITE_SENTRY_DSN` in Vercel's Production environment only. The frontend production
workflow supplies its production marker and release SHA. Local development,
tests, and ordinary preview builds do not initialize Sentry.

1. Open Issues and filter `environment:production`, time range, and release.
2. Inspect the exception type, stack location, and `operation` tag. Backend
   events may also include `roomCode` and `phase`.
3. Cross-reference the timestamp, room code, and operation with Render logs
   for the original error message and request ID.

Capture includes handled backend failures logged with `err` (timers, bots,
recovery, sockets, and unexpected HTTP errors), unhandled browser errors,
React render failures, and malformed successful API responses. Expected client
errors and normal network reconnects are not issues.

No user identity, raw exception messages, request payloads, game state, replay,
tracing, profiling, breadcrumbs, or source-code uploads. Configure email alerts
for new issues and regressions with a cooldown. After deployment, verify one
controlled private smoke error and inspect its sanitized event; local tests
alone do not prove delivery to the production Sentry account.

To disable, unset the relevant DSN and restart the backend or rebuild the
frontend. Quotas, retention, browser blockers, and offline clients limit capture.
Logical gameplay bugs without an exception are not automatically detected.

## Common scenarios

### "My card didn't play" / "the game froze"

1. Get the room code from the user.
2. Render logs → search `"roomCode":"<CODE>"` for the last hour.
3. Look for the last `card_played` event and the next expected turn (`turn_timer_started`).
4. If `auto_play_failed` appears, inspect its error: it may be a player/timeout race or a DB failure. If the server restarted, check `active_runtime_recovery_complete` and `/ready`. Recovery runs at startup and retries periodically; it does not require a player refresh.

### "I can't log in"

1. Sentry → filter `operation:unhandled_error` for unexpected backend failures. Wrong passwords and other expected client errors are not captured.
2. Render logs → look for that user's `req.id`.
3. Common causes: wrong cookie domain (cross-origin deploy needs `sameSite:'none'` + `secure:true`), DB unreachable.

### Annotation page is unavailable or has no scenarios

1. `GET https://beccaccino-server.onrender.com/api/annotations/status`:
   - `401` means the annotation API is deployed and requires normal login.
   - `404` means the annotation backend revision is not deployed.
2. If entering the shared code returns `503`, configure the backend-only
   `ANNOTATION_ACCESS_CODE` on Render and redeploy. Never expose it as a
   `VITE_` frontend variable.
3. If `/annotations/next` returns `scenario: null`, the account has answered
   every active scenario or the production pool is empty.
4. Confirm the annotation migration completed in the first Render startup logs.
   Before the first release, check Neon for any pre-existing
   `AnnotationScenario` or `ExpertAnnotation` prototype table; the migration
   expects to create both and must not be forced past a conflict.
5. Generate and retain a new offline batch, then run the backend importer
   against Neon without `--apply`. Verify the production host and summary
   before repeating the exact command with `--apply`.
6. Smoke-test `/annotate` with a real account and confirm one saved response
   increments the contribution count and loads another scenario.

The authoritative generation, import, replenishment, and recovery procedure is
[`ai/docs/EXPERT_DATA_COLLECTION.md`](ai/docs/EXPERT_DATA_COLLECTION.md).
Generation alone never modifies production; only an importer connected to Neon
with `--apply` writes scenario rows.

### Backend down / health check failing

1. Render → backend → Events tab. Was there a deploy? Did the container OOM?
2. `/health` only checks that the process is alive. `/ready` returns `503` with `database unreachable` or `runtime recovery incomplete`; check its reason and the recovery logs before blaming Neon.
3. Neon → Monitoring → connections. If queries time out, check pool usage and errors. Do not increase the connection limit blindly.
4. The Dockerfile runs `prisma migrate deploy` on startup. A migration failure crashes the container — check the very first log lines after a restart.

### Database connection exhaustion

Symptoms: requests time out, `prisma client error: too many connections`.

1. Confirm `DATABASE_URL` on Render uses the Neon **pooler** host (contains `-pooler`). For this beta, start with `connection_limit=5` and `pool_timeout=10`. Add query parameters with `&` if the URL already has `?`; preserve SSL parameters.
2. `DIRECT_URL` should be the non-pooled host (used by `migrate deploy` only). It
   must be **set** — Prisma fails schema validation on an unset `env()`, so a
   missing `DIRECT_URL` crashes the container at the startup `migrate deploy`
   rather than degrading gracefully.
3. If a stuck process is hoarding connections, restart the Render service.

### Sentry stack traces are minified

Source maps are not uploaded in this minimal setup. Browser stack locations
refer to deployed JavaScript bundles; backend locations refer to compiled
JavaScript. Match the release SHA before inspecting the corresponding local
build. Do not add upload tokens or assume a source-map upload job exists.

## Known caveats

- **Turn timers are in-memory.** Startup recovery restores active games, excluding paused games. The runtime reconciler retries every 30 seconds by default (`RUNTIME_RECONCILE_INTERVAL_MS`). Failed recovery keeps `/ready` unavailable.
- **Socket.IO sticky sessions.** If you scale Render to >1 instance you must enable a Redis adapter or sticky sessions. Currently single-instance.
- **Leaderboard cache.** 60 s in-memory TTL. After a game finishes, the leaderboard may not update for up to a minute.

## Operational levers (env vars)

| Need to...                          | Set on Render            | Effect                               |
| ----------------------------------- | ------------------------ | ------------------------------------ |
| Get verbose logs                    | `LOG_LEVEL=debug`        | Restart required                     |
| Disable Sentry temporarily          | unset `SENTRY_DSN`       | Restart required                     |
| Shorten game for testing            | `GAME_WIN_POINTS=12`     | Affects new rooms                    |
| Tune turn timeout                   | `TURN_TIMEOUT_SECONDS`   | Default 60 s                         |
| Tune briscola choice timeout        | `BRISCOLA_TIMEOUT_SECONDS` | Default 90 s                       |

## When things are really on fire

- **Roll back**: Render → backend → Manual Deploy → previous successful commit. Vercel → frontend → Deployments → previous → Promote to Production.
- **Database recovery**: follow the backup procedure above. Preview or restore into a separate branch first; never replace production blindly.
- **Drop traffic**: Vercel → frontend → set environment to `paused`, or scale Render service to 0 instances.

## Add to this runbook

Every time we hit a new failure mode, add a one-line scenario above with: symptom → where to look → fix. The next on-call (probably you again) will thank you.
