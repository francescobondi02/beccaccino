# BECCA — Operations Runbook

Quick reference for diagnosing and fixing production issues during beta. When something breaks at 11 PM, start here.

## Architecture at a glance

| Layer    | Hosted on | URL / dashboard |
| -------- | --------- | --------------- |
| Frontend | Vercel | https://beccaccino-client.vercel.app / Vercel BECCA project |
| Backend | Render | https://beccaccino-server.onrender.com / `becca-backend` logs |
| AI | Render | https://becca-ai.onrender.com / BECCA AI service logs |
| Database | Neon | https://console.neon.tech → BECCA project |
| Errors | Sentry | https://sentry.io → backend + frontend projects |

## First five minutes of any incident

1. Open Sentry — is there a fresh error spike? Filter by `environment:production` and the last 30 minutes.
2. Open Render → backend → Logs — search for `level:error` (or `"err"` in JSON logs).
3. Open Vercel → frontend → Logs and inspect the matching Sentry issue and
   breadcrumbs.
4. Check Neon → Monitoring — connection count, slow queries, CPU.
5. Confirm backend liveness with `/health`, then service readiness with
   `/ready`. Readiness requires both Neon connectivity and successful runtime
   recovery for active games; use the response reason and backend logs to
   distinguish them.

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
| Auto-play / runtime recovery          | `"auto_play_failed"` / `"turn_runtime_recovered"` / `"active_runtime_recovery_complete"` |
| Recent restarts                       | `"server_started"` / `"shutdown_initiated"`                  |
| Any unhandled error                   | `"uncaught_exception"` / `"unhandled_rejection"`             |

Every HTTP request gets a `req.id` (also returned in the `x-request-id` response header) so you can correlate a frontend network failure with backend logs.

## Sentry — finding what a user saw

1. Sentry → Issues → search by user: `user.id:42` or `user.username:"alice"`.
2. Inspect the issue breadcrumbs and request details around the failure.
3. Cross-reference the timestamp and `req.id` with Render logs.

User context is set on:
- Login / register (`AuthDialog`)
- Shared `/users/me` checks through `useAuth`
- Cleared on logout

If a Sentry event is missing `user`, the user wasn't logged in or the page hadn't checked auth yet.

## Common scenarios

### "My card didn't play" / "the game froze"

1. Get the room code from the user.
2. Render logs → search `"roomCode":"<CODE>"` for the last hour.
3. Look for the last `card_played` event and the next expected turn (`turn_timer_started`).
4. If the timer fired but `auto_play_failed` shows, the player may have clicked
   at the same time as the timeout. If neither fires, check for
   `server_started`, then `active_runtime_recovery_complete` and
   `turn_runtime_recovered`. State reads are intentionally side-effect free and
   do not repair missing runtime.

### "I can't log in"

1. Reproduce the request in the browser network panel and record its
   `x-request-id` response header.
2. Render logs → search for the matching request ID and HTTP status.
3. Common causes: invalid credentials, an expired cookie, wrong cookie policy,
   or an unavailable database.

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
2. `/health` only checks process liveness. `/ready` checks the database and
   active-game runtime recovery. Its response identifies which dependency is
   not ready.
3. Neon → Monitoring → connections. If at the pooler limit, restart Render service or temporarily raise `DATABASE_URL` `connection_limit`.
4. The Dockerfile runs `prisma migrate deploy` on startup. A migration failure
   crashes the container. Check the first startup logs, then follow
   **Migration failure** below rather than repeatedly redeploying.

### Migration failure

1. Stop the release. Do not mark a failed migration as applied just to make
   startup continue.
2. From a protected operator environment, run `npx prisma migrate status`
   against the direct Neon URL and identify the failed migration in both the
   output and `_prisma_migrations`.
3. Determine whether the SQL committed any changes. Compare the database schema
   with that migration before choosing a recovery action.
4. If it failed before making changes, fix the migration in a new commit and
   use `prisma migrate resolve --rolled-back <migration>` only after confirming
   the database is still at the previous schema.
5. If it made partial or destructive changes, stop application writes and
   restore or repair the database first. Never use `migrate resolve` to hide a
   schema that does not match the application.
6. Deploy the corrected backend and verify `/version`, `/ready`, migration
   status, and one representative read/write flow.

Production migrations must use expand/contract changes so the current and
previous backend can both run during a rollback window. A database restore is a
separate incident action, not an automatic consequence of rolling back code.

### Deployment did not reach production

1. Open the repository's GitHub Actions page and inspect `CI`, then
   `Deploy production`.
2. Missing deployment credentials fail the workflow. Configure
   `RENDER_DEPLOY_HOOK_URL` for each Render repository and `VERCEL_TOKEN` for
   the frontend repository. The frontend workflow resolves its Vercel project
   and organization IDs.
3. If CI passed but the deploy verification timed out, compare `/version`
   (or frontend `/version.json`) with the expected GitHub commit.
4. Keep Vercel and Render direct Git auto-deploy disabled so failed CI cannot
   bypass these gates. The AI Blueprint declares this setting; the backend
   Render service must be checked in the dashboard.

### Database connection exhaustion

Symptoms: requests time out, `prisma client error: too many connections`.

1. Confirm `DATABASE_URL` on Render uses the Neon **pooler** host (contains `-pooler`) and has `?connection_limit=5&pool_timeout=10` appended.
2. `DIRECT_URL` should be the non-pooled host (used by `migrate deploy` only). It
   must be **set** — Prisma fails schema validation on an unset `env()`, so a
   missing `DIRECT_URL` crashes the container at the startup `migrate deploy`
   rather than degrading gracefully.
3. If a stuck process is hoarding connections, restart the Render service.

### Sentry stack traces are minified

Source maps are uploaded by:
- **Frontend (Vercel)**: `vite build` creates hidden maps only when
  `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, and the release are all
  configured. The Sentry plugin uploads and removes them before publication.
- **Backend (GitHub Actions)**: the deployment workflow uploads maps after
  `tsc` when the Sentry repository secrets are configured. Docker builds never
  receive the Sentry token, and maps are excluded from the runtime image.

The release in `Sentry.init` must match the release used during upload. Verify
the deployed SHA in `/version` or `/version.json`, then find that exact release
in Sentry.

## Known caveats

- **Turn timers are in-memory.** A restart clears them, then startup recovery
  scans persisted active games and restores one runtime turn per room before it
  reports `active_runtime_recovery_complete`. Practice resume uses the same
  explicit recovery path. `GET /games/:roomCode/state` never schedules timers
  or bots. See `backend/src/runtime/recovery.ts`.
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

## Production rollback

Before every release, record the exact backend, AI, and frontend SHAs being
replaced. A rollback target is the last **compatible three-service set**, not
simply the previous deployment shown by each platform.

1. Stabilize traffic. For a data-corruption risk, pause the frontend or scale
   the backend to zero before changing deployments.
2. Record the incident time, currently deployed SHAs from `/version` and
   `/version.json`, and the intended rollback SHAs.
3. Check migrations made since the target backend. Code rollback does not undo
   schema or data changes. Continue only when those changes are backward
   compatible; otherwise repair or restore the database first.
4. Never roll the backend below `79381c1` while a room can contain `pausedAt`
   or `pauseEpoch` state. Older code does not understand the pause lifecycle.
5. Roll back in dependency order:
   - Render AI → deploy the recorded AI SHA; verify `/version`, `/health`, and
     `/tiers`.
   - Render backend → deploy the recorded backend SHA; verify `/version`,
     `/health`, and `/ready`.
   - Vercel frontend → promote the recorded frontend deployment; verify
     `/version.json` and load the main user workflow.
6. Verify one login, room listing, and practice-game flow. Confirm logs show no
   runtime-recovery or AI fallback spike.
7. Record the restored SHA set and database state in the incident notes.

Use Neon point-in-time restore only when the database itself must be reverted.
It can remove valid writes made after the restore timestamp, including expert
annotations, so capture or export recoverable data first.

## Add to this runbook

Every time we hit a new failure mode, add a one-line scenario above with: symptom → where to look → fix. The next on-call (probably you again) will thank you.
