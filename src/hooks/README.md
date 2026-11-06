# Hooks

## Overview
React hooks that coordinate REST requests, Socket.IO subscriptions and
reconnects for the live pages, plus small timer and reduced-motion hooks. Pure state
transitions live in `src/game/state.ts` and `src/rooms/`; socket plumbing lives
in `src/sockets/`.

## Interface
- `useAuth({ redirectOnFail = false } = {})` → `{ user, loading, error, retry, setUser, clearUser, logout }` [useAuth.ts:useAuth]
- `AuthUser` — `{ id, username, email? }`; `AUTH_QUERY_KEY` — `["auth", "current-user"]` [useAuth.ts:AuthUser], [useAuth.ts:AUTH_QUERY_KEY]
- `useConnectionStatus(onReconnect?)` → `ConnectionStatus` [useConnectionStatus.ts:useConnectionStatus]
- `useGameTable(gameRoomCode, userId, username, players)` → reducer state (minus the trick queue) plus `notice`, `completedTrick`, `fastCollection`, `gameStateStatus` (`loading` | `ready` | `error`), `refetchGameState`, `setRequestsEnabled(enabled)`, `applyLocalBriscola(suit)` [useGameTable.ts:useGameTable]
- `useLobbyRooms(userId)` → `{ availableRooms, activeGames, isLoading, pausedPracticeGames, ordinaryActiveGames, refreshRooms(showLoading?) }` [useLobbyRooms.ts:useLobbyRooms]
- `useReducedMotion()` → `true` while `(prefers-reduced-motion: reduce)` matches; used by `ArcadeLobby`, `GameBoard`, `PreviewStudio` and `MobilePreview` [useReducedMotion.ts:useReducedMotion]
- `useRoundDeal(deal, enabled)` → `RoundDealView` (`phase`, `dealtCards`, `startedAt`, `animationMs`) [useRoundDeal.ts:useRoundDeal]
- `useTurnCountdown(turnTimer)` → seconds remaining or `null` [useTurnCountdown.ts:useTurnCountdown]
- `useWaitingRoom({ roomCode, userId, username, onLoadError, onLeaveError })` → `{ room, isLoading, gameStarted, connectionStatus, leaveWaitingRoom(), configureBots(tier), setPlayerTeam(userId, team), setPlayerReady(userId, isReady) }`; `setPlayerTeam` and `setPlayerReady` only dispatch local reducer updates and make no REST call [useWaitingRoom.ts:useWaitingRoom]

## Invariants
- Auth: `GET /users/me` returning 401/403 means "logged out" (`user: null`), any other error surfaces as `error`; no retries, 5-minute stale time [useAuth.ts:fetchCurrentUser], [useAuth.ts:useAuth]
- `logout()` tolerates 401/403 from `POST /users/logout`, clears the cached user, then navigates to `/` with `replace` [useAuth.ts:useAuth]
- `onReconnect` fires only on a `connected` status that follows a disconnect after a previous connection [useConnectionStatus.ts:useConnectionStatus]
- `useGameTable` drops stale responses with request sequence counters and an `AbortController`; `setRequestsEnabled(false)` aborts all requests until re-enabled, which triggers a refetch [useGameTable.ts:useGameTable]
- Playable cards are requested only when the game is not paused, the local seat is not bot-controlled, no completed trick is queued, briscola is set, a hand number exists, fewer than 4 cards are on the table, and it is the local user's turn [useGameTable.ts:useGameTable]
- A completed trick stays visible for 3000 ms (1000 ms when `fastCollection`: last trick, a new round, or a finished game), then is released and state is refetched; while visible, turn, timer and playable cards are hidden [useGameTable.ts:useGameTable]
- `turn_timer_started` is anchored on the client receipt time (`Date.now()`), not the server clock [useGameTable.ts:useGameTable]
- `notice` messages come from `new_round_started`, `player_disconnected`, `auto_played` and `player_control_changed`, and clear after 8000 ms [useGameTable.ts:useGameTable]
- After a non-final `card_played` (trick size < 4) and after `briscola_chosen`, `useGameTable` schedules a 300 ms reconciliation refetch; any new `card_played` cancels pending refetches [useGameTable.ts:useGameTable]
- `practice_abandoned` for the current room calls `setRequestsEnabled(false)` and cancels scheduled refetches; `practice_paused` and `practice_resumed` refetch state [useGameTable.ts:useGameTable]
- `useLobbyRooms` refreshes rooms silently (`refreshRooms(false)`) on every lobby socket `connect` (including reconnects) and after each `practice_*` lobby event [useLobbyRooms.ts:useLobbyRooms]
- `useLobbyRooms` ignores out-of-order `/rooms/available` responses and clears rooms when there is no user [useLobbyRooms.ts:useLobbyRooms]
- `useWaitingRoom` deduplicates concurrent leave requests per `userId:roomCode`; a 409 on leave marks the game as started [useWaitingRoom.ts:useWaitingRoom]
- On unmount before the game starts, `useWaitingRoom` always leaves the socket room, but calls `POST /rooms/:code/leave` only on an actual route change and when the initial load did not fail [useWaitingRoom.ts:useWaitingRoom]
- `useRoundDeal` returns `{ phase: "ready", dealtCards: 10 }` when disabled or without a deal; phases run `collecting` → `dealing` → `reviewing` → `ready` against `deal.readyAt` [useRoundDeal.ts:useRoundDeal]
- `useReducedMotion` returns `false` when `window.matchMedia` is unavailable [useReducedMotion.ts:useReducedMotion]
- `useTurnCountdown` returns `null` for bot turns (`totalMs === null`) and never goes below 0 [useTurnCountdown.ts:useTurnCountdown]

## Side Effects
- REST via `src/lib/api.ts`: `GET /users/me`, `POST /users/logout` [useAuth.ts:useAuth]; `GET /games/:code/state`, `GET /games/playable-cards/:code` [useGameTable.ts:useGameTable]; `GET /rooms/available` [useLobbyRooms.ts:useLobbyRooms]; `GET /rooms/:code?userId=…`, `GET /rooms/:code`, `POST /rooms/:code/leave`, `POST /rooms/:code/bots` [useWaitingRoom.ts:useWaitingRoom]
- Socket.IO room join: `useGameTable` and `useWaitingRoom` call `registerRoomHandlers`, which emits `join_room` on each socket `connect`; every successful join refetches game state (`useGameTable`) or `GET /rooms/:code` (`useWaitingRoom`) [useGameTable.ts:useGameTable], [useWaitingRoom.ts:useWaitingRoom]
- Socket.IO (room) subscriptions in `useGameTable`: `card_played`, `briscola_chosen`, `new_round_started`, `game_finished`, `player_disconnected`, `turn_timer_started`, `auto_played`, `player_control_changed`, `practice_paused`, `practice_resumed`, `practice_abandoned`; cleanup calls `leaveRoom(code)` [useGameTable.ts:useGameTable]
- Socket.IO (room) subscriptions in `useWaitingRoom`: `player_joined`, `player_left`, `team_chosen`, `ready_changed`, `room_settings_changed`, `game_started` [useWaitingRoom.ts:useWaitingRoom]
- Socket.IO (lobby) subscriptions in `useLobbyRooms`: `room_created`, `room_updated`, `room_full`, `room_deleted`, `practice_paused`, `practice_resumed`, `practice_abandoned`; cleanup calls `leaveLobby()` [useLobbyRooms.ts:useLobbyRooms]
- TanStack Query cache writes for the auth user, and router navigation [useAuth.ts:useAuth]
- `sonner` toast and `console.error` on lobby load failure; `console.error` on game-state and playable-card failures [useLobbyRooms.ts:useLobbyRooms], [useGameTable.ts:useGameTable]
- `useReducedMotion` adds and removes a `matchMedia` `change` listener [useReducedMotion.ts:useReducedMotion]
- Timers (`setTimeout` / `setInterval`) in `useGameTable`, `useRoundDeal`, `useTurnCountdown` [useRoundDeal.ts:useRoundDeal], [useTurnCountdown.ts:useTurnCountdown]

## Verification
- Run: `cd frontend && npx vitest run src/__tests__/hooks`
- Run: `cd frontend && npm run typecheck && npm run lint`
