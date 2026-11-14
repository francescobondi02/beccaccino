# Backend agent notes

Read the root [CLAUDE.md](../CLAUDE.md) and [README.md](./README.md) first.

- Change a game only through `runGameAction`. Code that already holds the room
  lock (game start, `leaveRoom`, practice retire) calls `runGameActionUnlocked`; the lock is not reentrant.
- A change function checks its own rules, writes its rows and returns a
  `LastAction`, or `null` when there is nothing to do. It must not publish,
  arm timers or bump `version`; `runGameAction` does that.
- `toGameState` and `GET /api/games/:roomCode/state` are pure reads. Never
  start a timer, run a bot or repair the runtime from a read.
- Put rules in `domain/game/` and use them from transitions, `gameState` and
  bots. Do not copy a rule into a second place.
- Final scores, round history and player counters come from
  `services/gameResult.ts`, for both the end-of-game push and later reads.
- Turn deadlines and presentation timings come from `gameConfig.ts` and
  `runtime/timeoutPolicy.ts:turnTimes`. The server sends absolute end times;
  clients never copy the constants.
- Keep the Python bot wire format (`hands`, `current_trick`,
  `completed_tricks` in `services/botState.ts`) as is. The fixture test in
  `tests/integration/botStateFixtures.test.ts` guards it.
- Tests must close every server, socket and timer they open. Do not leave dev
  servers running after a test command.
- The backend assumes one running instance. Locks and timers live in memory.
