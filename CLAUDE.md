# Backend — Express + Socket.IO + Prisma

Node 24, TypeScript, Express 5. Stateful WebSocket server for real-time card game.

## Structure

```
src/
  index.ts              Process entry: env validation, listen, background jobs, shutdown
  server.ts             HTTP + Socket.IO factory: JWT auth, IP admission, handlers
  app.ts                Express app: middleware, routes, health/readiness probes
  gameConfig.ts         Game-wide environment-backed rules such as win points
  db.ts                 Prisma client singleton
  socketInstance.ts     Global io getter/setter (used by services to emit events)
  annotations/
    constants.ts        Fixed difficulty, tag, and importance vocabulary
    scenario.ts         Discriminated scenario/action parsing and public-state validation
    selection.ts        Unanswered-scenario usefulness ranking
  domain/
    cards.ts            Prisma-backed card enums, signal types, and parsers
    publicPlayer.ts     Public player projection for room payloads
  controllers/
    userController.ts   Register, login, logout, profile, stats, leaderboard
    annotationController.ts Annotation status, access, next scenario, response upsert
    roomController.ts   Create room, join room, list rooms
    gameController.ts   Choose briscola, play card, get playable cards, get game state
    chooseTeam.ts       Team selection logic
  services/
    gameService.ts      Core game transitions; returns timer directives
    gameState.ts        Loads the browser game-state DTO and restores timers
    turnCoordinator.ts  Applies directives for controller-driven game actions
    cardService.ts      Gets playable cards with follow-suit filtering
    turnTimer.ts        Timer/bot state, autoplay, kick after 3 timeouts
    roomCommands.ts     Serialized room lifecycle, team, and ready commands
    practiceRoomSweeper.ts  Locked cleanup of finished or stale practice rooms
    practiceArchive.ts  Snapshots a practice game before its rows are deleted
  sockets/
    room.ts             All socket event handlers: lobby, room join/leave, game events, chat
  middleware/
    auth.ts             JWT cookie auth (bypassed in test via x-test-user-id header)
    annotationAccess.ts Account-level expert-access gate
    validate.ts         Input validation for game endpoints (suit/value enum checks)
    rateLimiter.ts      Per-route rate limiting
  routes/
    users.ts            /api/users/*
    rooms.ts            /api/rooms/*
    games.ts            /api/games/*
    annotations.ts      /api/annotations/* (account auth + shared-code access gate)
  scripts/
    annotationDatabase.ts Safe status/import/export operator CLI
    importAnnotationScenarios.ts Transactional offline-batch import
    exportAnnotations.ts Pseudonymous JSONL export
    exportPracticeMatches.ts JSONL export of archived practice games
  utils/
    computePoints.ts    Raw points → {points, figures} per team
    determineHandWinner.ts  Trick winner logic (briscola > lead suit > off-suit)
    generateRoomCode.ts 6-char room codes (unambiguous charset — no 0/O, 1/I)
    jwt.ts              Sign/verify JWT tokens
    password.ts         bcrypt hash/compare
    random.ts           Seeded RNG for deterministic card shuffle (Fisher-Yates)
    sanitizeChatMessage.ts  Production chat input sanitizer
prisma/
  schema.prisma         Models: User, Player, GameRoom, Round, Hand, PlayedCard, PlayerCard, PracticeMatch
  migrations/           17 migrations
tests/
  unit/                 Pure rules, card parsing, scoring, room codes, chat sanitization
  integration/          Full API tests with real DB plus production server/socket tests
  helpers/              Shared: setupGame, oneRound, clearDatabase
  loadTestEnv.ts        Overrides DATABASE_URL to becca_test before Prisma loads
  setup.ts              Mocks socket.io, sets NODE_ENV=test
  teardown.ts           Disconnects Prisma
```

## Key Implementation Details

### Game Flow (gameService.ts)
1. `startFirstRound()` atomically marks the room started, calls `setupRound()`, and returns a timer directive
2. `setupRound()` shuffles the deck, deals 10 cards per player, and determines the caller
3. `setBriscola()` validates the caller and atomically creates the first Hand
4. `playCard()` validates follow-suit and atomically advances the hand or round
5. On round end, scores are committed and the next round starts or the game finishes

### Socket Events (emitted by server)
- `room_created`, `room_updated`, `room_full`, `room_deleted` — lobby
- `player_joined`, `player_left`, `team_chosen`, `ready_changed`, `game_started` — room
- `new_round_started`, `briscola_chosen`, `card_played`, `round_ended`, `game_finished` — game
- `turn_timer_started`, `auto_played`, `player_kicked_timeout` — timer
- `practice_paused`, `practice_resumed`, `practice_abandoned`, `player_disconnected` — lifecycle
- `chat_message` — in-game chat

### Auth
- Cookie name: `authToken`, httpOnly, 7-day expiry
- Production: `secure: true`, `sameSite: 'strict'` (same-origin) or `'none'` (cross-origin)
- `createServer()` applies Socket.IO JWT auth before per-IP admission, then attaches verified identity to `socket.data.user`

### Expert Annotations
- Normal BECCA account authentication protects all four endpoints:
  `GET /api/annotations/status`, `POST /api/annotations/access`,
  `GET /api/annotations/next`, and `POST /api/annotations/responses`.
  The access endpoint verifies `ANNOTATION_ACCESS_CODE` and records expert
  access on the account.
- Deterministic scenario batches are generated offline by the AI package,
  validated again by the backend, and imported transactionally into SQL. Each
  imported scenario declares `play_card` or `choose_briscola`; historical rows
  default to `play_card`. Existing identifiers and state hashes cannot be
  overwritten. `--replace-active` can make the incoming batch the active
  catalog without deleting older scenarios or responses.
- `scripts/annotations/` provides guarded status, import, and export wrappers.
  They require a mode-`600` environment file, print only a sanitized database
  target, default imports to dry-run, and bind apply to the exact dry-run plan.
- Selection keeps each user's answers near the 20/40/40 difficulty mix and
  ranks unanswered scenarios by importance divided by the square root of one
  plus its global response count.
- Scenario hash, the matching discriminated action, perceived difficulty, and
  an optional 500-character skip comment are verified server-side before an
  idempotent per-account/per-scenario upsert. One current response row is stored
  for that pair; no response-history portal exists.
- The UI shows an open-ended contribution count. A null next scenario means
  only that the user has answered every currently active scenario.
- `scripts/annotations/export.sh` emits the exact visible scenario with
  deterministic user pseudonyms and optional skip comments; it never reads
  username or email and atomically creates a mode-`600` output file.

### Practice Game Archive
- `deleteRoomAndPlay` snapshots a practice game into one `PracticeMatch` row
  before deleting it, in the same transaction. It is the only exit practice data
  has: leaving the table deletes the room immediately, and the sweeper deletes
  finished or day-old ones.
- The payload holds each seat's dealt cards plus every card played in order,
  which is enough to rebuild the complete game. Each round has a separate
  `humanActions` list containing only direct human choices. Bot moves remain
  replay context and never appear in that training-label list.
- A full game is ~20 KB of JSON but
  **~1.4 KB on disk**: Postgres compresses JSONB over ~2 KB automatically
  (measured 15x), so there is nothing to gain from compressing it in the app.
- `PlayedCard.autoPlayed` and `Round.briscolaAutoChosen` mark moves the server
  chose (human timeout, or the fallback when the bot service fails). They are
  used while building `humanActions`; `true` and unknown (`null`) choices are
  excluded.
- Practice archives contain no account ID, username, email, or pseudonym.

### Database Notes
- Player has unique constraints on `[gameRoomId, seat]` and `[gameRoomId, userId]`
- AnnotationScenario has unique `code` and `stateHash` fields; ExpertAnnotation
  is unique on `[userId, scenarioId]`. `decisionType` defaults to `play_card`;
  briscola choices use `selectedBriscola` while card choices retain the
  existing selected card and signal columns.
- PlayedCard.signal: nullable string ("striscio"|"busso"|"volo"|null), only set for trick leader (position 0)
- Indexes on all foreign keys (added in migration 20260517190703)
- `binaryTargets` includes `linux-musl-arm64-openssl-3.0.x` for Docker Alpine

## Build & Deploy

```bash
npm run build           # prisma generate + tsc → dist/
npm start               # node dist/index.js
```

Dockerfile: multi-stage Node 24 Alpine build; the runtime applies migrations before starting.
GitHub Actions builds and starts the Dockerfile, then triggers the Render deploy
hook for the exact tested commit only after all CI jobs pass on `main`. Render's
direct Git auto-deploy stays disabled.

Practice games require `BOT_SERVICE_URL` and `BOT_SERVICE_TOKEN`. Creation
checks the AI service's authenticated, tier-specific `/ready` endpoint before
writing room state, while individual `/act` calls keep a 5-second timeout.
The server also sweeps practice rooms immediately at startup and every 10
minutes, deleting finished rooms or rooms inactive for at least 24 hours.
Successful briscola choices and card plays update the activity timestamp in the
same transaction as the move. Each candidate is revalidated under its room lock;
room/game rows are removed while shared bot users are retained.

The human participant can pause and resume an active practice game through
`POST /api/rooms/:roomCode/pause` and `/resume`. Persisted `pausedAt` state
suppresses timers across restarts, while `pauseEpoch` prevents bot responses
started before pause from advancing a resumed game. Resume starts a fresh turn
timer, and paused rooms still expire after 24 hours of inactivity.

Only an active *multiplayer* game blocks creating or joining another one
(`findActiveGame`). Practice games are excluded, so one left open by a crash
never locks the account out. Starting a new practice game while old practice
games exist is equivalent to abandoning those old games and creating a new one.
The replacement must be playable before the old practice rooms are deleted and
is removed if setup or deletion fails. Leaving is still refused
mid-multiplayer-game and always allowed in practice, where it deletes the room.

## Test Commands

```bash
npm run typecheck           # compile checks without output
npm run build               # prisma generate + tsc → dist/
npm run test:unit           # Jest unit project only
npm run test:integration    # Jest integration project, --runInBand (sequential DB access)
npm test                    # Both projects
```

Integration tests require `finch compose up -d db` from the project root (PostgreSQL on localhost:5432).
DB is cleared between tests via `clearDatabase()` in beforeEach.
