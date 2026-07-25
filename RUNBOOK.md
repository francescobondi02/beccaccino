# BECCA — Operations Runbook

Quick reference for diagnosing and fixing production issues during beta. When something breaks at 11 PM, start here.

## Architecture at a glance

| Layer    | Hosted on | URL / dashboard                                    |
| -------- | --------- | -------------------------------------------------- |
| Frontend | Vercel    | https://vercel.com → BECCA project → Logs / Deploys |
| Backend  | Render    | https://dashboard.render.com → becca-backend → Logs |
| Database | Neon      | https://console.neon.tech → BECCA project          |
| Errors   | Sentry    | https://sentry.io → backend + frontend projects     |

## First five minutes of any incident

1. Open Sentry — is there a fresh error spike? Filter by `environment:production` and the last 30 minutes.
2. Open Render → backend → Logs — search for `level:error` (or `"err"` in JSON logs).
3. Open Vercel → frontend → Logs (or check Sentry replay if a session was captured).
4. Check Neon → Monitoring — connection count, slow queries, CPU.
5. Confirm the backend is alive: `curl https://<backend>/health` should return `{"status":"ok"}`.

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
| Auto-play firing                      | `"auto_play_failed"` or `"turn_timer_recovered_after_restart"` |
| Recent restarts                       | `"server_started"` / `"shutdown_initiated"`                  |
| Any unhandled error                   | `"uncaught_exception"` / `"unhandled_rejection"`             |

Every HTTP request gets a `req.id` (also returned in the `x-request-id` response header) so you can correlate a frontend network failure with backend logs.

## Sentry — finding what a user saw

1. Sentry → Issues → search by user: `user.id:42` or `user.username:"alice"`.
2. Click the issue → Replays tab → watch the session leading up to the error.
3. Cross-reference the timestamp + `req.id` with Render logs.

User context is set on:
- Login / register (`AuthDialog`)
- `/users/me` checks on every page (Index, GameRoom, GameTable, Profile, Leaderboard)
- Cleared on logout

If a Sentry event is missing `user`, the user wasn't logged in or the page hadn't checked auth yet.

## Common scenarios

### "My card didn't play" / "the game froze"

1. Get the room code from the user.
2. Render logs → search `"roomCode":"<CODE>"` for the last hour.
3. Look for the last `card_played` event and the next expected turn (`turn_timer_started`).
4. If the timer fired but `auto_play_failed` shows, that's a benign race (player clicked at the same time as the timeout). If neither fires, the server may have restarted — check `server_started` near that timestamp. The next state fetch will lazily restart the timer (`turn_timer_recovered_after_restart`).

### "I can't log in"

1. Sentry → look for `login_failed` or `register_user_failed`.
2. Render logs → look for that user's `req.id`.
3. Common causes: wrong cookie domain (cross-origin deploy needs `sameSite:'none'` + `secure:true`), DB unreachable.

### Backend down / health check failing

1. Render → backend → Events tab. Was there a deploy? Did the container OOM?
2. `/health` endpoint probes the DB. If it's 503, the failure is at the Neon side.
3. Neon → Monitoring → connections. If at the pooler limit, restart Render service or temporarily raise `DATABASE_URL` `connection_limit`.
4. The Dockerfile runs `prisma migrate deploy` on startup. A migration failure crashes the container — check the very first log lines after a restart.

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
- **Frontend (Vercel)**: `vite build` runs `@sentry/vite-plugin` if `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` are set as Vercel env vars. The release tag comes from `VERCEL_GIT_COMMIT_SHA` (also set on `Sentry.init` via `VITE_SENTRY_RELEASE`).
- **Backend (Render)**: Dockerfile runs `npm run sentry:sourcemaps` after `tsc`. Pass the same three secrets as build args, and `RENDER_GIT_COMMIT` for the release tag. Verify in Sentry → Releases that the SHA appears with attached source maps.

Common gotcha: the release in `Sentry.init` must match the release passed to the upload step. Both default to the git commit, so they should agree as long as both are set.

## Known caveats

- **Turn timers are in-memory.** A server restart mid-game wipes them. The first `getGameState` fetch after restart restores the active timer, so auto-play resumes — but the player may need to refresh. Documented at `backend/src/controllers/gameController.ts` (lazy timer recovery block).
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
- **Database point-in-time restore**: Neon → Branches → restore to a timestamp before the incident.
- **Drop traffic**: Vercel → frontend → set environment to `paused`, or scale Render service to 0 instances.

## Add to this runbook

Every time we hit a new failure mode, add a one-line scenario above with: symptom → where to look → fix. The next on-call (probably you again) will thank you.
