# Turn Runtime

## Overview

In-process runtime for live games: one scheduled turn timer per room, bot seat
metadata, bot move execution, human timeout autoplay and takeover, startup and
periodic recovery from persisted state, and best-effort Socket.IO publication.
Persisted game state is owned by `../game/transitions`; this layer only
schedules work and calls those transitions with fencing arguments
(`expectedPauseEpoch`, `expectedTurn`, `expectedBotModel`).

## Interface

- `turnRuntime.ts`
  - `startRuntimeTurn(roomCode, userId, phase, pauseEpoch, identity, delayMs = 0)`:
    schedules the turn and publishes `turn_timer_started`.
  - `clearRuntimeRoom(roomCode)`, `clearAllRuntime()`.
- `turnTimer.ts`
  - `scheduleTurnTimer({ roomCode, userId, phase, pauseEpoch, identity, durationMs, isBot, onElapsed, onFailed? })`.
  - `clearTurnTimer(roomCode)`, `clearAllTurnTimers()`.
  - `getTurnTimerState(roomCode)`: `{ remainingMs, totalMs, turnUserId, phase, isBot }` or `null`.
  - `hasTurnRuntime(roomCode, userId, phase, pauseEpoch, identity)`.
- `botRegistry.ts`
  - `registerBotSeats(roomCode, seats)`, `restoreBotSeats(roomCode, players)`,
    `botTierForTurn(roomCode, userId)`, `hasBotSeat(roomCode, userId)`,
    `clearBotSeats(roomCode)`, `clearAllBotSeats()`.
- `botExecutor.ts`
  - `executeBotTurn({ roomCode, userId, tier, phase, expectedPauseEpoch, expectedTurn })`.
- `autoPlay.ts`
  - `autoPlayCard(roomCode, userId, expectedPauseEpoch?, expectedTurn?, expectedBotModel?)`.
  - `autoChooseBriscola(roomCode, userId, expectedPauseEpoch?, expectedTurn?, expectedBotModel?)`.
- `timeoutExecutor.ts`
  - `executeTimedOutTurn({ roomCode, userId, phase, expectedPauseEpoch, expectedTurn })`.
- `timeoutPolicy.ts`
  - `turnDurationMs(phase)`, `botThinkDelayMs()`.
- `recovery.ts`
  - type `RuntimeRecoverySummary` (`{ activeRooms, recoveredRooms, failedRoomCodes }`).
  - `isRuntimeRecoveryReady()`, `setRuntimeRecoveryReady(ready)`.
  - `recoverRoomRuntime(roomCode)` (locked), `recoverRoomRuntimeUnlocked(roomCode)`.
  - `recoverRooms(roomCodes, recover = recoverRoomRuntime)`.
  - `reconcileActiveRuntime()`.
- `reconciler.ts`
  - `startRuntimeReconciler({ intervalMs?, reconcile? } = {})`,
    `stopRuntimeReconciler()`.
- `eventPublisher.ts`
  - type `GameEvent` (`{ target, event, payload }`).
  - `publishEvent(target, event, payload, context = {})`, `publishEvents(events)`.

## Invariants

- Each room has at most one active timer; scheduling a new one clears the old
  one. A firing timer runs only if it is still the room's current timer, and
  the entry is removed after `onElapsed` finishes (`turnTimer.ts:scheduleTurnTimer`,
  `executeTurn`).
- `hasTurnRuntime` matches user, phase, pause epoch, and exact
  `TurnIdentity`; recovery schedules a turn only when no matching runtime
  exists (`recovery.ts:recoverRoomRuntimeUnlocked`).
- Human turns last `TURN_TIMEOUT_SECONDS` (default 60) or, for briscola,
  `BRISCOLA_TIMEOUT_SECONDS` (default 90); bot turns last
  `BOT_THINK_DELAY_MS` (default 1000). `delayMs` is added for bot turns and
  for `choose_briscola`, but not for human `play_card` turns
  (`timeoutPolicy.ts`, `turnRuntime.ts:startRuntimeTurn`).
- `turn_timer_started` sends `totalMs: null` for bot turns
  (`turnRuntime.ts:startRuntimeTurn`).
- A turn is a bot turn when the room's bot registry maps the user to a
  `BotTier`; `restoreBotSeats` registers players whose `botModel` is a valid
  tier (`botRegistry.ts`).
- Bot moves are skipped when the seat is no longer registered or the room is
  paused or has a different `pauseEpoch`. The bot service response must be the
  expected move kind for the phase, and the bot must own the current turn
  seat. Bot moves pass `expectedBotModel: tier`. For `play_card`,
  `executeBotTurn` sends `readPlayableCards` as `expectedLegalCards` to
  `requestBotMove`, which drives the bot service's legal-card agreement check
  (`botExecutor.ts:executeBotTurn`).
- A failed bot move falls back to autoplay with the same fencing, except on
  cancellation errors, when the bot seat is no longer registered
  (`bot_move_abandoned_room_gone`), or when the pause epoch is no longer
  current (`botExecutor.ts:executeBotTurn`).
- Autoplay plays the first legal card from `readPlayableCards`; auto-briscola
  picks the suit with the most cards in hand, breaking ties by the
  alphabetically smallest suit name (`autoPlay.ts`).
- A human timeout autoplays with `expectedBotModel: null` (incrementing
  `timeoutCount`), publishes `auto_played`, and then calls
  `changePlayerControl({ action: "timeout" })`, which hands a multiplayer seat
  to a bot at three consecutive timeouts (`timeoutExecutor.ts:executeTimedOutTurn`).
- Practice humans are never replaced by timeout takeover: timeouts still
  autoplay and increment `timeoutCount`, but the `"timeout"` action is a no-op
  in practice rooms, so the practice archive keeps exactly one human
  (`../services/playerControl.ts:changePlayerControlUnlocked`).
- `PracticeTurnCancelledError` and `RuntimeTurnCancelledError` are treated as
  normal cancellation, not failures (`botExecutor.ts`, `timeoutExecutor.ts`).
- When a timed turn throws, `onFailed` attempts `recoverRoomRuntime` for that
  room (`turnRuntime.ts:startRuntimeTurn`).
- Recovery only touches started, unfinished, unpaused rooms, runs under
  `withRoomLock`, completes interrupted multiplayer takeovers (human players
  with `timeoutCount >= 3` get `replacementBotTier`; skipped for practice
  rooms), clears the existing timer before rescheduling if an overdue player
  owns the current turn, and adds the remaining deal presentation time to
  recovered `choose_briscola` turns (`recovery.ts:recoverRoomRuntimeUnlocked`).
- Readiness starts `true` only when `NODE_ENV === "test"`;
  `reconcileActiveRuntime` sets it to `true` only when every active room
  recovers without error (`recovery.ts`).
- The reconciler never overlaps runs; its interval is
  `RUNTIME_RECONCILE_INTERVAL_MS` (default 30000) unless overridden
  (`reconciler.ts:startRuntimeReconciler`).
- Event publication never throws; failures are logged as
  `event_publication_failed` (`eventPublisher.ts:publishEvent`).
- All runtime state is per-process memory; there is no distributed timer
  ownership.

## Side Effects

- In-memory state: `activeTimers` (`turnTimer.ts`), `botSeats`
  (`botRegistry.ts`), recovery readiness flag, reconciler timer.
- Timers: per-turn `setTimeout`, a 10-minute interval that clears timers older
  than 2 hours (`turnTimer.ts`), and the reconciler interval; all are unref'd.
- Database: reads in `autoPlay.ts`, `botExecutor.ts`, and `recovery.ts`;
  `Player.botModel` writes during takeover recovery; all game writes go
  through `setBriscola` and `playCard`.
- Network: bot move requests through `../services/botClient.ts`.
- Socket.IO emits via `getSocketInstance()`: `turn_timer_started`,
  `auto_played`, plus events emitted by called transitions and services.
- Structured logs for failures, fallbacks, recovery, and reconciliation.

## Verification

- Run: `cd backend && npx jest tests/unit/turnTimer.test.ts tests/unit/runtimeRecovery.test.ts tests/unit/roundPacing.test.ts`
- Run: `cd backend && npx jest tests/integration/botTurns.test.ts tests/integration/runtimeIdentity.test.ts tests/integration/practicePause.test.ts tests/integration/multiplayerBots.test.ts --runInBand`
  (needs the `becca_test` PostgreSQL database)
