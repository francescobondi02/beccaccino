# Services

## Overview

Application operations behind the controllers, runtime, and sockets: accounts
and credentials, room queries and lifecycle for multiplayer and practice
rooms, participant departure and player control, read-only game-state and
legal-card queries, final game results, statistics, the Python bot service
client and its state serializer, bot accounts and tiers, practice archiving
and sweeping, and ops metrics. Each mutating operation owns its database
writes, runtime handoff, and best-effort Socket.IO publication.

## Interface

- `account.ts`: `getAccount(userId)`, `updateUsername(userId, username)`,
  `deleteAccount(userId)`.
- `userAuth.ts`: `registerUser({ username, password, email })`,
  `loginUser({ username, password })`; both return the user without
  `password`.
- `roomCode.ts`: `generateUniqueRoomCode()`.
- `roomQueries.ts`: `ActiveGameConflictError` (409, `details.activeRoomCode`),
  `assertNoActiveMultiplayerGame(userId)`, `listRoomsForLobby(userId)`
  (`{ availableRooms, activeGames }`), `getRoomForUser(roomCode, userId)`.
- `multiplayerRooms.ts`: `createMultiplayerRoom(userId)`,
  `joinMultiplayerRoom({ roomCode, userId })`,
  `chooseMultiplayerTeam({ roomCode, userId, team })`,
  `configureMultiplayerBots({ roomCode, userId, tier })`,
  `setMultiplayerReady({ roomCode, userId, isReady })`.
- `practiceRooms.ts`: type `PracticeRetirementReason`,
  `retirePracticeRoom({ roomCode, reason })`,
  `createPracticeRoom({ userId, tier })`,
  `pausePracticeRoom({ roomCode, userId })`,
  `resumePracticeRoom({ roomCode, userId })`.
- `practiceRoomSweeper.ts`: `sweepPracticeRooms(now?)`,
  `startPracticeRoomSweeper()`, `stopPracticeRoomSweeper()`.
- `practiceArchive.ts`: type `PracticeMatchRecord`,
  `buildPracticeMatch(room)`, `archivePracticeMatch(tx, gameRoomId)`.
- `leaveRoom.ts`: `leaveRoom({ roomCode, userId, onlyIfWaiting? })`.
- `playerControl.ts`: `changePlayerControl({ roomCode, userId, action })`
  (`action`: `"abandon" | "resume" | "timeout"`),
  `changePlayerControlUnlocked(args)`.
- `gameState.ts`: `loadGameState(roomCode, userId)`.
- `playableCards.ts`: `readPlayableCards({ roomCode, userId })`.
- `gameResult.ts`: `readGameResult(client, gameRoomId, winnerTeam)`.
- `statistics.ts`: `getUserStatistics(userId)`, `getLeaderboardStatistics()`.
- `botUsers.ts`: `BOT_TIERS` (`facile`, `medio`, `forte`, `esperto`), type
  `BotTier`, `isBotTier`, `replacementBotTier(room)`, `ensureBotUsers()`.
- `botClient.ts`: type `BotMove`, `BotServiceError`,
  `ensureBotServiceReady(tier)`, `requestBotMove({ state, seat, tier, expectedLegalCards? })`.
- `botState.ts`: types `BotState`, `BotTurn`, `BotStateError`,
  `buildBotTurn(roomCode, userId)`.
- `metrics.ts`: `startMetrics()`, `stopMetrics()`.

## Invariants

- Accounts: usernames and emails are unique (409). Login rejects missing,
  deleted, or password-less users with 401 "Invalid credentials". Deleting an
  account is refused while the user is a player in a started, unfinished game;
  otherwise it removes memberships in unstarted rooms, sets `deletedAt`,
  anonymizes `username`/`email`, and clears `password` and
  `expertAccessGrantedAt` (`account.ts`, `userAuth.ts`). It publishes no
  Socket.IO events and does not delete rooms left empty
  (`account.ts:deleteAccount`).
- A user may not create or join a multiplayer room or create a practice room
  while holding a non-abandoned membership in any unfinished multiplayer room
  (`roomQueries.ts:assertNoActiveMultiplayerGame`).
- `getRoomForUser` and `loadGameState` reject non-members (403) and members
  who abandoned an unfinished game.
- Room mutations run under `withRoomLock(roomCode)`; practice creation locks
  `practice-user:<userId>`.
- Multiplayer rooms hold at most four players; joining requires an unstarted
  room. Team changes are allowed only before start and before readying, with
  at most two players per team. Changing bot tier or leaving an unstarted room
  resets every remaining player's `isReady` (`multiplayerRooms.ts`,
  `leaveRoom.ts`).
- A ready change starts the game when every player is ready and either both
  teams have two players or a valid `botTier` is set and every player has a
  team; missing seats are filled with pool bots after
  `ensureBotServiceReady` (`multiplayerRooms.ts:setMultiplayerReady`).
- Practice rooms seat the human at seat 0 (team 0) and three pool bots of one
  tier; creating one retires the user's previous practice rooms
  (`practiceRooms.ts:createPracticeRoom`).
- Practice retirement archives the match and deletes all room rows in one
  transaction; runtime is cleared only after that commit
  (`practiceRooms.ts:retirePracticeRoom`). The sweeper retires practice rooms
  that are finished or idle for 24 hours: once at start, then every 10
  minutes, without overlapping sweeps (`practiceRoomSweeper.ts`).
- Archives require one human, three same-tier bots, seats 0-3, and ten dealt
  cards per seat per round; only manual human choices
  (`briscolaAutoChosen === false`, `autoPlayed === false`) are recorded as
  human actions, and games without any are not archived
  (`practiceArchive.ts:buildPracticeMatch`). Humans are players with
  `botModel === null`; practice humans are never replaced by timeout takeover,
  so the practice archive keeps exactly one human.
- Pausing increments `pauseEpoch` and clears the timer; resuming clears
  `pausedAt`, increments `pauseEpoch` again, restores bot seats, and starts
  the current turn only if no matching runtime exists. Resume calls
  `startRuntimeTurn` directly, not `recoverRoomRuntimeUnlocked`, so a resumed
  `choose_briscola` turn gets no deal presentation delay. Only the human player
  of an active practice room can pause or resume
  (`practiceRooms.ts:pausePracticeRoom`, `resumePracticeRoom`).
- Leaving a practice room retires it. Leaving a started, unfinished
  multiplayer room abandons the seat to a bot without deleting the player;
  leaving a finished room changes nothing; the last player leaving an
  unstarted room deletes it (`leaveRoom.ts:leaveRoom`).
- Player control: `resume` is forbidden for abandoned seats; `abandon` is not
  allowed for practice rooms; `timeout` changes control only for a human seat
  with `timeoutCount >= 3` in a multiplayer room and is a no-op in practice
  rooms (timeouts there still autoplay and increment `timeoutCount`).
  Replacement bots use `replacementBotTier`
  (room `botTier`, then an existing bot's tier, then `forte`)
  (`playerControl.ts:changePlayerControlUnlocked`, `botUsers.ts`).
- `loadGameState` is read-only: it reads in a `RepeatableRead` transaction,
  retries up to three times if the room changed, and returns 409 otherwise. It
  never starts timers, runs bots, or repairs runtime. `allHands` is returned
  only for practice rooms; the bot timer's `totalMs` is `null`
  (`gameState.ts`).
- `readGameResult` derives final scores with `sumRoundScores`, counts tricks,
  `busso` signals, and aces captured by the opposing trick winner
  (`gameResult.ts`).
- Statistics and the leaderboard count only finished, non-practice games
  (`RANKED_FINISHED_GAME`); the leaderboard excludes bots and deleted users,
  sorts by wins, win rate, then points, returns the top 50, and caches results
  for 60 seconds outside tests (`statistics.ts`).
- Bot users are a fixed pool of three usernames with `isBot: true` and no
  password; `ensureBotUsers` throws if a pool username belongs to a real user
  (`botUsers.ts:ensureBotUsers`).
- The bot client requires `BOT_SERVICE_URL` and `BOT_SERVICE_TOKEN`, uses a
  5-second move timeout and a 75-second readiness timeout, sends
  `expected_legal_cards` for the service's legality check, and validates the
  returned move shape (`botClient.ts`).
- `BotState` sends suits and values as enum strings, all four hands, and
  cumulative raw scores (`points * 3 + figures`) of completed rounds
  (`botState.ts`).

## Side Effects

- Prisma reads and writes on `User`, `GameRoom`, `Player`, `Round`, `Hand`,
  `PlayerCard`, `PlayedCard`, and `PracticeMatch`.
- Runtime handoff: `startFirstRound`, `startRuntimeTurn`, `clearTurnTimer`,
  `clearRuntimeRoom`, `registerBotSeats`, `restoreBotSeats`,
  `recoverRoomRuntimeUnlocked`.
- Socket.IO events via `publishEvent`: `room_created`, `room_updated`,
  `room_full`, `room_deleted`, `team_chosen`, `ready_changed`,
  `room_settings_changed`, `player_left`, `player_control_changed`,
  `practice_paused`, `practice_resumed`, `practice_abandoned`.
- HTTP calls to the bot service (`GET /ready?tier=`, `POST /act`) with a
  `Bearer` token (`botClient.ts`).
- Password hashing via `../utils/password.ts` (`userAuth.ts`).
- In-memory leaderboard cache; unref'd intervals for the sweeper (10 min) and
  metrics (60 s, logs `ops_snapshot`).

## Verification

- Run: `cd backend && npx jest tests/unit/botClient.test.ts tests/unit/practiceArchive.test.ts`
- Run: `cd backend && npx jest tests/integration/rooms.test.ts tests/integration/practiceRoom.test.ts tests/integration/practicePause.test.ts tests/integration/practiceRoomSweeper.test.ts tests/integration/practiceArchive.test.ts tests/integration/startedGameLeave.test.ts tests/integration/leaderboard.test.ts tests/integration/deleteAccount.test.ts --runInBand`
  (needs the `becca_test` PostgreSQL database)
