# Decisions

The owner's decisions from the 2026 simplification, and the alternatives we
rejected. The code is the reference; this file says why it looks the way it does.

## Decisions

| ID | Decision |
| --- | --- |
| D1 | One backend instance. In-memory locks and timers are fine. |
| D2 | A live game survives a server restart: startup recovery plus a reconciler. |
| D3 | The browser talks only to the Vercel domain (`/api` and the socket proxy). No API URL variables. |
| D4 | Store the caller of each round and the winner of each game. |
| D5 | Store each round score as one raw number per team. |
| D6 | Vocabulary: Game > Round > Trick. Hand = the cards a player holds. Tables use these names. |
| D7 | Keep the full trick history of every game, for AI training. |
| D8 | Practice games are normal games with bots, in the same tables. No practice archive. |
| D9 | Practice games do not count in stats or the leaderboard. |
| D10 | No annotation feature. |
| D11 | Practice games can be paused and resumed across days. A practice game idle for 30 days closes with no winner. |
| D12 | After 3 timeouts in a row in a multiplayer game, a bot takes the seat. Only "take back control" returns it. |
| D13 | The website supports laptop and desktop windows of at least 1024×600 px and is not installable. Phones and tablets use the native app. |
| D14 | Game routes use the room code in the path. |
| D15 | No test authentication bypass. Tests sign real tokens. |
| D16 | The web app uses React Query for every REST read. |
| D17 | One shared contract (TypeScript types in `backend/src/contract/`) for server, web and mobile. |
| D18 | Short documentation in simple English. |
| D19 | One monorepo. No production users yet, so deploy at any time with no compatibility window. |
| D20 | The production database may be wiped once (backup first). One baseline migration replaces the old history. |
| D21 | Games with no winner do not count in stats. |
| D22 | Each player sees only their own hand, in practice too. The last completed trick is shown in "Ultima presa". |
| D23 | Lobby and room changes are two events, `room_changed` and `lobby_changed`. Clients refetch over REST. |
| D24 | The native app runs in Expo Go only. Installed builds and version checks come later. |
| D25 | The 4-player Playwright game runs in CI on `main` only. |
| D26 | Custom domain later. Review the cookie policy then. |
| D27 | Feature PRs target `develop`. A PR from `develop` to `main` releases to production. CI runs on both. |

## Changes after the Phase 3b review

- The briscola deadline starts when the deal presentation ends:
  `max(turnStartedAt, reviewEndsAt)`. The deal no longer eats the caller's 90 s.
- Briscola and card use one turn check. A move out of turn gets 403, and other
  conflicts get 409, instead of a silent success.
- Control changes are `resumePlayerControl` plus an inline abandon in
  `leaveRoom`. Pause and resume share `setPracticePaused`.
- `RuntimeTurnCancelledError` and `PracticeRoomCleanupError` are gone. Every
  control change bumps the game version, so a stale timer or bot reply is
  already dropped.
- Renames: `hasTurnRuntime` is `isTimerArmed`, `recordTurn` is
  `updateTimeoutCount`.

## Alternatives considered

| Topic | Chosen | Rejected | Why |
| --- | --- | --- | --- |
| Updates to clients | full state per player | diffs; one event per action | Diffs need client copies of the rules and break on one lost message. The state is a few KB. |
| Contract | TypeScript types in `backend/src/contract/` | OpenAPI; a root `shared/` folder | OpenAPI does not cover Socket.IO and needs a generator. A root folder breaks the backend build and Docker image. |
| Stale timers and bot replies | `GameRoom.version` | a pause epoch plus turn identity; an in-memory counter | One counter covers moves, pause, resume and control changes. In the database it also orders client states and detects a second instance during a deploy. |
| Display timing | absolute end times plus `serverTime` | remaining milliseconds | An absolute time stays right after a refetch or a late message. |
| Push timing | send inside the lock, after commit | send after the lock | Sends leave in commit order, so clients rarely see an older version. |
| Write path | one `runGameAction` | code per action | Every change bumps the version, re-arms the timer and pushes in one place. |
| Self-repair | keep the reconciler | retry at startup only | It is small and also heals a game that loses its timer while running. |
| Data access | Prisma in use cases plus `loadLiveGame` | a repository layer | One read shape for games is enough at this size. |
| Score storage | raw per team | points plus figures | One number, no split arithmetic. The contract still shows points and figures. |
| Practice storage | same tables | an archive table | One data set for stats and training. |
| Schema change | wipe and new baseline | data migration with backfill | No users, so no backfill scripts or maintenance window. |
| Table names | real rename | Prisma `@@map` | Code and SQL use the same words. Free after the wipe. |
| Origin | Vercel `/api` and socket proxy | sockets direct to Render | Same-origin cookies, no CORS or CSRF code. Cost: the socket reconnects every 300 s. |
| Repository | monorepo | submodules | Web and mobile import the backend contract. One PR per change. |
