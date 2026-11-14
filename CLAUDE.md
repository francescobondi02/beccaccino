# BECCA — Beccaccino Online

Real-time online Beccaccino, the Italian card game for 4 players in 2 teams.
Website for laptop and desktop, native app for phones. Start with
[README.md](./README.md) for running and testing, and
[docs/decisions.md](./docs/decisions.md) for why the design looks this way.

```
backend/    Node 24, Express 5, Socket.IO, Prisma, PostgreSQL 15. Owns every game.
frontend/   React 18, Vite, Tailwind, shadcn/ui. Website, desktop only (1024×600 px or more).
mobile/     Expo, React Native, Expo Router. Runs in Expo Go.
ai/         Python game engine, bot training and the bot inference service.
```

One monorepo with no npm workspaces. Web and mobile import the wire types from
`backend/src/contract/` through the `@contract/*` path.

Clients send changes over REST and receive state over Socket.IO. Each push of
`game_state` carries the full state for that player. Room changes push
`room_changed` and `lobby_changed`, and clients refetch over REST.

## Glossary

- **Game**: one match until a team reaches the target. Model `GameRoom`, which
  is also the lobby room.
- **Round**: 40 cards dealt, one caller, one briscola, 10 tricks. Model `Round`.
- **Trick**: four cards, one per player. Model `Trick`; its cards are `PlayedCard`.
- **Hand**: the cards one player holds in the current round. Model `HandCard`.
- **Briscola**: the trump suit of a round, chosen by the caller.
- **Caller**: the player who chooses the briscola and leads trick 1.
- **Cricca**: the caller holds tre, due and asso of the briscola. `Round.cricca`.
- **Signal**: an optional call by the player who leads a trick: `striscio`,
  `busso` or `volo`. Everyone sees it.
- **Raw score**: points in thirds. Real points = `raw // 3`, figures = `raw % 3`.
- **Target**: `GAME_WIN_POINTS`, default 41 real points.
- **Timeout**: a human did not act before the deadline. The server plays for them.
- **Bot tier**: `facile`, `medio`, `forte` or `esperto`. Stored in
  `Player.botModel` while a bot controls the seat.
- **Version**: `GameRoom.version`, a counter that every game change increments.

## Game rules

- Seats 0 and 2 are team 0; seats 1 and 3 are team 1. Play goes clockwise.
- 40-card Italian deck: suits `denara`, `coppe`, `spade`, `bastoni`, 10 values each.
- Round 1 caller: the holder of the quattro di denara. Later rounds: the next
  seat after the previous caller.
- The caller picks the briscola, then leads the first trick.
- Follow the lead suit if you can; otherwise play any card.
- Trick winner: the highest briscola, else the highest card of the lead suit.
- Strength, high to low: tre, due, asso, re, cavallo, fante, sette, sei, cinque, quattro.
- Raw points: asso 3; tre, due, re, cavallo, fante 1; others 0. The last trick
  adds 3. A round gives 35 raw. Cricca adds 9 raw to the caller's team.
- The game ends after the round in which a team reaches the target. If both
  teams reach it, more real points win; an exact tie goes to the caller's team.

## Backend layers

1. `routes/`: URL to controller, with auth and rate-limit middleware.
2. `controllers/`: parse input with `http/input/*`, call one use case, send the
   result. No `try/catch`; `http/errorHandler.ts` maps errors.
3. `services/` (rooms, accounts, stats) and `game/` (actions on a live game):
   use cases. They call Prisma directly. There is no repository layer.
4. `domain/game/`: pure rules on the plain `LiveGame` type.
5. `runtime/`: turn timers, bot turns, startup recovery, reconciler and publishing.
6. `sockets/room.ts`: connection, room presence and chat. No game changes.
7. `contract/`: wire types shared with web and mobile. Imports nothing.

Every game change goes through `runGameAction(roomCode, change)` in
`game/runGameAction.ts`. It takes the room lock, loads the game once
(`loadLiveGame`), runs the change, increments `version` with a compare-and-set,
commits, re-arms the turn timer and pushes `game_state` to each human, all
inside the lock. Timers and bot replies carry the version they were armed for
and do nothing if it moved. A human move that loses the race gets 409.

## Turns, timeouts and bots

- A human has 60 s to play a card and 90 s to choose the briscola. The briscola
  clock starts when the deal presentation ends. On timeout the server plays.
- Deadlines come from `GameRoom.turnStartedAt`, so a restart keeps them.
- After 3 timeouts in a row in a multiplayer game, a bot takes the seat in the
  same transaction. A human move resets the count. Practice games count
  timeouts but never give the seat to a bot.
- Only `POST /api/rooms/:roomCode/resume-control` gives the seat back.
  Reconnecting does not.
- Leaving a started multiplayer game hands the seat to a bot for good; the game
  still counts in stats.
- Practice games are normal games with 3 bots in the same tables. They can be
  paused. Leaving, starting a new one, or 30 days idle closes the game as
  finished with no winner. A started practice game is never deleted.
- Games with no winner and practice games do not count in stats or the
  leaderboard.
- Bots are 3 fixed `User` rows (`services/botUsers.ts`). Their moves come from
  the Python service; if it fails, the server picks a legal card.

## Module map

Backend (`backend/src/`):

- `index.ts`, `server.ts`, `app.ts`: process start and shutdown, HTTP and
  Socket.IO setup, routes, `/health` and `/ready`.
- `gameConfig.ts`: target, timeouts and presentation timings.
- `domain/game/`: cards, legal cards, trick winner, round and game score,
  cricca, turn order, `resolvePlay`.
- `game/liveGame.ts`: `loadLiveGame`. `game/gameState.ts`: pure `toGameState`,
  the state one player sees. `game/runGameAction.ts`: the write path.
- `game/transitions/round.ts`: game start, round setup, briscola, timeout count.
  `game/transitions/cardPlay.ts`: card play, round and game end.
- `runtime/`: `turnTimer`, `turnRuntime`, `botExecutor`, `timeoutPolicy`,
  `recovery`, `reconciler`, `eventPublisher`.
- `services/`: `multiplayerRooms`, `practiceRooms`, `leaveRoom`,
  `playerControl`, `practiceRoomSweeper`, `roomQueries`, `account`,
  `userAuth`, `statistics`, `gameResult`, `botUsers`, `botState`, `botClient`.
- `http/`: auth cookie, error handler, typed errors, `input/` parsers.
- `auth/activeSession.ts`, `middleware/`: token checks and rate limits.
- `utils/roomLock.ts`: per-room lock, not reentrant.

Frontend (`frontend/src/`): `pages/` (`LobbyPage`, `GameRoom`, `GameTable`,
`Practice`, `Profile`, `Leaderboard`), `hooks/` (React Query and socket
coordination), `sockets/socketClient.ts`, `components/`.

Mobile (`mobile/src/`): Expo Router screens in `app/`. The native app is
independent of the website UI. Login, lobby, waiting room and the live table
(practice and multiplayer) use the same REST and Socket.IO API. Do not replace
native screens with web components or change server rules for presentation.

AI (`ai/`): `becca_env/` mirrors the backend rules; `serving/` is the bot
service. See [ai/CLAUDE.md](./ai/CLAUDE.md).

## Data

Models: `User`, `GameRoom`, `Player`, `Round`, `Trick`, `PlayedCard`,
`HandCard`. Prisma enums are lowercase: `denara`, `asso`.

- `Round.team0Raw` and `team1Raw` store raw points. `toTeamScore`
  (`domain/game/gameScore.ts`) turns raw into points and figures.
- `Round.callerId` and `GameRoom.winnerTeam` are stored, not derived.
- `PlayedCard.autoPlayed` and `Round.briscolaAutoChosen` mark moves the server
  chose. Exclude them from training labels.

## Conventions

- Code and docs in English. UI text in Italian.
- Use `userId` and `playerId` names, never a bare `id` across layers.
- Auth: a JWT in the `httpOnly` cookie `authToken`, `sameSite: lax`, `secure`
  in production. The website reaches the API on its own origin: Vite proxies in
  dev, Vercel rewrites in production. The native app sends
  `Authorization: Bearer` and Socket.IO `auth.token`.
- Tests sign real tokens; there is no auth bypass.
- Run Node, npm and Prisma in the containers (`make ...`,
  `docker compose exec <service> ...`).

## Commands

```sh
make dev | make qr | make logs | make test | make stop | make reset
docker compose exec backend npm run typecheck
docker compose exec frontend npm run lint
docker compose exec mobile npm run check
cd ai && pytest
```

## Environment variables

| Module | Variable | Purpose |
| --- | --- | --- |
| backend | `DATABASE_URL` | Postgres connection (required) |
| backend | `DIRECT_URL` | Non-pooled Postgres URL for Prisma migrations (required) |
| backend | `JWT_SECRET` | Token signing key (required) |
| backend | `PORT` | Server port, default 8000 |
| backend | `NODE_ENV` | `development`, `production` or `test` |
| backend | `GAME_WIN_POINTS` | Target, default 41 |
| backend | `TURN_TIMEOUT_SECONDS` | Card timeout, default 60 |
| backend | `BRISCOLA_TIMEOUT_SECONDS` | Briscola timeout, default 90 |
| backend | `BOT_SERVICE_URL` | Bot service URL; unset disables bots |
| backend | `BOT_SERVICE_TOKEN` | Shared secret for the bot service |
| backend | `BOT_THINK_DELAY_MS` | Pause before a bot move, default 1000 |
| backend | `LOG_LEVEL` | Pino log level |
| backend | `RUNTIME_RECONCILE_INTERVAL_MS` | Reconciler interval, default 30000 |
| frontend | `BACKEND_URL` | Dev proxy target, default `http://localhost:8000` |
| mobile | `EXPO_PUBLIC_BACKEND_URL` | API origin; empty means production |
| ai | `BOT_SERVICE_TOKEN` | Required by `/act` and `/ready` |
