# Backend — Express + Socket.IO + Prisma

Node 24, TypeScript, Express 5. Stateful WebSocket server for real-time card game.

## Structure

```
src/
  index.ts              Entry point: HTTP server + Socket.IO setup + JWT socket auth
  app.ts                Express app: CORS, helmet, cookieParser, routes
  db.ts                 Prisma client singleton
  socketInstance.ts     Global io getter/setter (used by services to emit events)
  controllers/
    userController.ts   Register, login, logout, profile, stats, leaderboard
    roomController.ts   Create room, join room, list rooms
    gameController.ts   Choose briscola, play card, get playable cards, get game state
    chooseTeam.ts       Team selection logic
  services/
    gameService.ts      Core game logic: startRound, setBriscola, playCard, scoring
    cardService.ts      Deal cards, get playable cards (follow-suit filtering)
    turnTimer.ts        Per-room timeout map, auto-play, kick after 3 timeouts
  sockets/
    room.ts             All socket event handlers: lobby, room join/leave, game events, chat
  middleware/
    auth.ts             JWT cookie auth (bypassed in test via x-test-user-id header)
    validate.ts         Input validation for game endpoints (suit/value enum checks)
    rateLimiter.ts      Per-route rate limiting
  routes/
    users.ts            /api/users/*
    rooms.ts            /api/rooms/*
    games.ts            /api/games/*
  utils/
    computePoints.ts    Raw points → {points, figures} per team
    determineHandWinner.ts  Trick winner logic (briscola > lead suit > off-suit)
    generateRoomCode.ts 4-char uppercase room codes
    jwt.ts              Sign/verify JWT tokens
    password.ts         bcrypt hash/compare
    random.ts           Seeded RNG for deterministic card shuffle (Fisher-Yates)
prisma/
  schema.prisma         Models: User, Player, GameRoom, Round, Hand, PlayedCard, PlayerCard
  migrations/           7 migrations (init → indexes → signal column)
tests/
  unit/                 Pure logic: computePoints, determineHandWinner, roomCode, chat sanitization
  integration/          Full API tests with real DB: users, rooms, game flow, concurrency, sockets
  helpers/              Shared: setupGame, oneRound, clearDatabase
  loadTestEnv.ts        Overrides DATABASE_URL to becca_test before Prisma loads
  setup.ts              Mocks socket.io, sets NODE_ENV=test
  teardown.ts           Disconnects Prisma
```

## Key Implementation Details

### Game Flow (gameService.ts)
1. `startRound()` — shuffles deck (seeded RNG), deals 10 cards per player, determines caller
2. `setBriscola()` — validates caller, sets suit, creates first Hand, starts turn timer
3. `playCard()` — validates follow-suit, saves PlayedCard (with optional signal), checks trick complete
4. On trick complete: determines winner, updates trick_starter, checks if round over (10 hands)
5. On round end: computes scores, checks if game over (≥ GAME_WIN_POINTS), starts new round or finishes

### Socket Events (emitted by server)
- `room_created`, `room_updated`, `room_full`, `room_deleted` — lobby
- `player_joined`, `player_left`, `team_chosen`, `player_ready`, `game_started` — room
- `round_started`, `briscola_chosen`, `card_played`, `hand_complete`, `round_ended`, `game_finished` — game
- `turn_timer_started`, `auto_played`, `player_kicked_timeout` — timer
- `chat_message` — in-game chat
- `your_turn` — unicast to current player

### Auth
- Cookie name: `authToken`, httpOnly, 7-day expiry
- Production: `secure: true`, `sameSite: 'strict'` (same-origin) or `'none'` (cross-origin)
- Socket.IO: extracts cookie from `socket.handshake.headers.cookie`, verifies JWT, attaches `socket.data.user`

### Database Notes
- Player has unique constraint on `[gameRoomId, seat]`
- PlayedCard.signal: nullable string ("striscio"|"busso"|"volo"|null), only set for trick leader (position 0)
- Indexes on all foreign keys (added in migration 20260517190703)
- `binaryTargets` includes `linux-musl-arm64-openssl-3.0.x` for Docker Alpine

## Build & Deploy

```bash
npm run build           # prisma generate + tsc → dist/
npm start               # node dist/index.js
```

Dockerfile: multi-stage not needed (single stage, npm ci + build + CMD with migrate).
Render auto-deploys from `backend/` root directory on push.

## Test Commands

```bash
npm run test:unit           # Jest unit project only
npm run test:integration    # Jest integration project, --runInBand (sequential DB access)
npm test                    # Both projects
```

Integration tests require `docker compose up -d` (postgres on localhost:5432).
DB is cleared between tests via `clearDatabase()` in beforeEach.
