# Game Transitions

## Overview

Atomic, mutating game transitions: round setup and game start (`round.ts`),
briscola choice (`round.ts`), and card play including trick, round, and game
completion (`cardPlay.ts`). Each transition validates the persisted state,
commits its writes in one Prisma transaction, then hands off to the runtime
(timers and bots) and publishes Socket.IO events on a best-effort basis.

## Interface

- `round.ts`
  - `PracticeTurnCancelledError` (`GameError`, 409, "Practice game is paused").
  - `RuntimeTurnCancelledError` (`GameError`, 409, "Runtime turn is no longer
    current").
  - `assertPlayerControl(player, expectedBotModel?)`: rejects a stale runtime
    move or a manual move on a bot-controlled or abandoned seat.
  - `claimPracticeTransition(tx, room, expectedPauseEpoch?)`: for practice rooms,
    claims an unpaused room (optionally of a specific `pauseEpoch`) and bumps
    `lastActivityAt`.
  - `setupRound(gameRoomId, roundNumber, tx)`: deals a new round and returns
    `{ gameRoomId, roundNumber, roundId, callerPlayerId, createdAt }`. The
    created number is the previous round (`roundNumber - 1`) plus one; if that
    round does not exist, it is 1, whatever `roundNumber` was requested.
  - `logRoundSetup(result)`: logs a `round_setup` entry.
  - `startFirstRound(gameRoomId, roomCode, multiplayer?)`: marks the room
    started, optionally readies the starting player and inserts bot players,
    deals round 1, and starts the caller's `choose_briscola` turn.
  - `setBriscola({ gameRoomId, playerId, suit, autoChosen?, expectedPauseEpoch?, expectedTurn?, expectedBotModel? })`:
    sets the round's briscola and cricca flag and creates trick (`Hand`) 1.
- `cardPlay.ts`
  - `playCard({ roomCode, userId, suit, value, signal?, autoPlayed?, expectedPauseEpoch?, expectedTurn?, expectedBotModel? })`:
    plays one card and completes the trick, round, or game when applicable.
    Before turn checks it throws `GameError`: 404 "Room not found or game not
    started", 400 "Game is already finished", 403 "It's not this player's turn"
    (caller is not a room player), 400 "No active round or hand found", and
    400 "Hand is already full".
- Turn identity and phase types come from [`../turn.ts`](../turn.ts); caller
  lookup comes from [`../snapshots/README.md`](../snapshots/README.md); pure
  rules come from [`../../domain/game/README.md`](../../domain/game/README.md).

## Invariants

- `setBriscola` and `playCard` run under `withRoomLock(roomCode)`, so two
  mutations for the same room never interleave in this process
  (`round.ts:setBriscola`, `cardPlay.ts:playCard`).
- `startFirstRound` claims the room with `updateMany({ started: false })`; a
  second start throws `GameError("Game has already started", 409)`.
- `setupRound` requires exactly four players. In round 1 it clears and
  reassigns seats so team 0 sits at seats 0 and 2 and team 1 at seats 1 and 3,
  and it requires two players per team. Each player receives 10 cards from a
  shuffled 40-card deck (`getRng()`).
- Round 1's caller holds quattro di denara; later callers rotate one seat
  clockwise from the previous round's first trick starter
  (`round.ts:setupRound`).
- Briscola is set only once per round (`round.updateMany` with
  `briscola: null`), only by the resolved caller, and creates trick 1 started
  by the caller. Cricca is detected from the caller's cards
  (`round.ts:setBriscolaUnlocked`).
- `playCard` accepts only the player at the resolved turn seat, a card the
  player holds, and a card that follows the lead suit when possible. Signals
  are kept only on the trick's first card (`cardPlay.ts:playCardUnlocked`).
- Runtime moves pass `expectedTurn`; a mismatch with the current
  `{ roundId, handId, playedCardCount }` throws `RuntimeTurnCancelledError`.
- `expectedBotModel` encodes control: `undefined` is a manual human move
  (requires `botModel === null` and no `abandonedAt`; resets `timeoutCount` to
  0), `null` is a human timeout move (increments `timeoutCount`), and a string
  is a bot move that must match `Player.botModel`
  (`round.ts:assertPlayerControl`, `cardPlay.ts:persistPlayedCard`).
- Paused rooms (`pausedAt` set) reject transitions with
  `PracticeTurnCancelledError`; practice transitions must also match
  `expectedPauseEpoch` when given (`round.ts:claimPracticeTransition`).
- The fourth card of tricks 1-9 sets the trick winner and creates the next
  trick started by the winner; the fourth card of trick 10 scores the round
  with `computeRoundScore` + `settleRound` (cricca bonus to the caller team),
  sums all completed rounds, and checks `decideGameWinner` against
  `GAME_WIN_POINTS` (`cardPlay.ts:playCardUnlocked`).
- When the game ends, the room is marked `finished` and the result comes from
  `readGameResult`; otherwise the next round is set up in the same transaction.
- Database transactions commit before runtime turns start or are cleared.
  Move events publish before the next turn's runtime starts, and
  `clearRuntimeRoom` runs before `game_finished` is published. Exception:
  `startFirstRound` runs `restoreBotSeats` and `startRuntimeTurn` (which emits
  `turn_timer_started`) before publishing `game_started` and lobby
  `room_deleted`.
- Runtime turn delays: the next trick's `play_card` turn starts after
  `TRICK_DISPLAY_MS` (`cardPlay.ts:playCardUnlocked`); every new
  `choose_briscola` turn starts after `roundDealPresentation(...).remainingMs`
  (`round.ts:startFirstRound`, `cardPlay.ts:playCardUnlocked`).

## Side Effects

- Prisma writes: `GameRoom` (`started`, `finished`, `lastActivityAt`),
  `Player` (`seat`, `isReady`, bot rows, `timeoutCount`), `Round`, `PlayerCard`
  (create/delete), `PlayedCard`, and `Hand` (create, `winnerId`).
- Runtime: `startRuntimeTurn`, `clearRuntimeRoom`, and `restoreBotSeats` from
  `../../runtime`. `startFirstRound` clears runtime on any failure.
- Socket.IO events via `publishEvents`: `game_started`, lobby `room_deleted`,
  `briscola_chosen`, `card_played`, `round_ended`, `new_round_started`, and
  `game_finished`.
- Structured logs: `round_setup`, `briscola_set`, `card_played`, `round_ended`,
  `game_finished`.

## Verification

- Run: `cd backend && npx jest tests/integration/gameStart.test.ts tests/integration/runtimeIdentity.test.ts tests/integration/startedGameLeave.test.ts tests/integration/practiceRoom.test.ts --runInBand`
  (needs the `becca_test` PostgreSQL database)
- Run: `cd backend && npm run typecheck`
