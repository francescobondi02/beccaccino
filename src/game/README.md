# Game State

## Overview
Client game model, pure presentation selectors and the reducer used by the live
table (`src/hooks/useGameTable.ts`). The server remains authoritative; these
modules only shape and display its data.

## Interface
- Model types: `Signal`, `PlayerPosition`, `PlayerCard`, `PlayerControl`, `RoundDeal`, `RoundDealView`, `PlayedCardData`, `CompletedTrick`, `TotalPoints`, `TurnTimer`, `RoundEndData`, `MoveLogEntry`, `RevealedHand` [model.ts:PlayerCard], [model.ts:TurnTimer]
- `GameStateResponse` — response of `GET /games/:code/state` (`status`, `round` with optional `deal`, `myCards`, `playedCards`, `lastHandCards`, `totalPoints`, `turnTimer`, `finishedGame`, `isPractice`, `playerControls?`, `allHands`, `roundSummary?`, …) [model.ts:GameStateResponse]
- `PositionedPlayer` — `RoomPlayer` plus `position`, `isLocalPlayer`, `isTeammate` [presentation.ts:PositionedPlayer]
- `trickWinner(cards, briscola): number | null` [presentation.ts:trickWinner]
- `positionPlayers(players, currentUserId): PositionedPlayer[]` [presentation.ts:positionPlayers]
- `pointsForPlayerTeam(totalPoints, team)` → `{ own, opponents }` [presentation.ts:pointsForPlayerTeam]
- `GameTableState`, `GameTableAction`, `initialGameTableState`, `gameTableReducer(state, action)` [state.ts:GameTableState], [state.ts:GameTableAction], [state.ts:initialGameTableState], [state.ts:gameTableReducer]

## Invariants
- `trickWinner` is presentation only; it returns `null` unless there are exactly 4 cards, a briscola, a lead card (`position === 0`) and known values; the highest briscola wins, else the highest lead-suit card, using strength order tre > due > asso > re > cavallo > fante > sette > sei > cinque > quattro [presentation.ts:trickWinner]
- `positionPlayers` returns `[]` if the current user is not in `players`; seats are sorted (null seats last) and mapped relative to the local player as `bottom`, `left`, `top`, `right` [presentation.ts:positionPlayers]
- `pointsForPlayerTeam` treats any team other than `0` (including `null`) as team 1 [presentation.ts:pointsForPlayerTeam]
- `turnTimer.startedAt` is rebuilt on the client clock as `now - (totalMs - remainingMs)`, or `now` for bot turns (`totalMs === null`) [state.ts:gameTableReducer], [model.ts:TurnTimer]
- `roundDeal` is set only when `round.deal.remainingMs > 0`, with `readyAt = now + remainingMs` [state.ts:gameTableReducer]
- `card_played` clears the current turn, timer and playable cards (the next timer arrives via `turn_timer_started`), starts a new trick when `position === 0`, removes the card from `myCards` when it is the local user's, and queues a `CompletedTrick` when 4 cards are on the table [state.ts:gameTableReducer]
- `playable_cards_fetched` is ignored while any completed trick is still queued [state.ts:gameTableReducer]
- `completed_trick_released` drops the oldest queued trick and clears `playedCards` only if they are exactly that trick in the same round [state.ts:gameTableReducer]
- The move log is cleared when a fetched state belongs to a different round, and on `new_round_started` [state.ts:gameTableReducer]
- `player_control_changed` replaces that user's control entry and clears playable cards [state.ts:gameTableReducer]

## Side Effects
- None. All exports are types, constants or pure functions.

## Verification
- Run: `cd frontend && npx vitest run src/__tests__/game src/__tests__/hooks/gameTableReducer.test.ts`
- Run: `cd frontend && npm run typecheck && npm run lint`
