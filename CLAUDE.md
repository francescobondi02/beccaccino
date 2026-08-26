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
    scenario.ts         Generated scenario parser and public-state validation
    selection.ts        Per-user difficulty balancing and usefulness ranking
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
    importAnnotationScenarios.ts Transactional offline-batch import
    exportAnnotations.ts Pseudonymous JSONL export
  utils/
    computePoints.ts    Raw points → {points, figures} per team
    determineHandWinner.ts  Trick winner logic (briscola > lead suit > off-suit)
    generateRoomCode.ts 6-char room codes (unambiguous charset — no 0/O, 1/I)
    jwt.ts              Sign/verify JWT tokens
    password.ts         bcrypt hash/compare
    random.ts           Seeded RNG for deterministic card shuffle (Fisher-Yates)
    sanitizeChatMessage.ts  Production chat input sanitizer
prisma/
  schema.prisma         Models: User, Player, GameRoom, Round, Hand, PlayedCard, PlayerCard
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
- `practice_abandoned`, `player_disconnected` — lifecycle
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
  validated again by the backend, and imported transactionally into SQL.
  Existing scenario identifiers and state hashes cannot be overwritten.
- Selection keeps each user's answers near the 20/40/40 difficulty mix and
  ranks unanswered scenarios by importance and global response count without a
  response cap.
- Scenario hash, the complete suit/value/signal legal action, perceived
  difficulty, and an optional 500-character skip comment are verified
  server-side before an idempotent per-account/per-scenario upsert. One current
  response row is stored for that pair; no response-history portal exists.
- The UI shows an open-ended contribution count. A null next scenario means
  only that the user has answered every currently active scenario.
- `ANNOTATION_EXPORT_SALT=... npm run annotations:export` emits the exact
  visible scenario with deterministic user pseudonyms and optional skip
  comments; it never reads username or email.

### Database Notes
- Player has unique constraints on `[gameRoomId, seat]` and `[gameRoomId, userId]`
- AnnotationScenario has unique `code` and `stateHash` fields; ExpertAnnotation
  is unique on `[userId, scenarioId]`
- PlayedCard.signal: nullable string ("striscio"|"busso"|"volo"|null), only set for trick leader (position 0)
- Indexes on all foreign keys (added in migration 20260517190703)
- `binaryTargets` includes `linux-musl-arm64-openssl-3.0.x` for Docker Alpine

## Build & Deploy

```bash
npm run build           # prisma generate + tsc → dist/
npm start               # node dist/index.js
```

Dockerfile: multi-stage Node 24 Alpine build; the runtime applies migrations before starting.
Render auto-deploys from `backend/` root directory on push.

Practice games require `BOT_SERVICE_URL` and `BOT_SERVICE_TOKEN`. Creation
checks the AI service's authenticated, tier-specific `/ready` endpoint before
writing room state, while individual `/act` calls keep a 5-second timeout.
The server also sweeps practice rooms immediately at startup and every 10
minutes, deleting finished rooms or rooms inactive for at least 24 hours.
Successful briscola choices and card plays update the activity timestamp in the
same transaction as the move. Each candidate is revalidated under its room lock;
room/game rows are removed while shared bot users are retained.

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
