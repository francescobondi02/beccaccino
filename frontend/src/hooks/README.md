# Hooks

## Overview
React hooks that coordinate REST requests, Socket.IO subscriptions and
reconnects for the live pages, plus small timer, media-query and app-update hooks. Pure state
transitions live in `src/game/state.ts` and `src/rooms/`; socket plumbing lives
in `src/sockets/`.

## Interface
- `useAppUpdate()` — production-only polling of `/version.json`; mounted once by `App` [useAppUpdate.ts:useAppUpdate]
- `useAuth({ redirectOnFail = false } = {})` → `{ user, loading, error, retry, setUser, clearUser, logout }`; `redirectOnFail` is `true` (redirect to `/`) or a target path [useAuth.ts:useAuth]
- `AuthUser` — `{ id, username, email? }`; `AUTH_QUERY_KEY` — `["auth", "current-user"]` [useAuth.ts:AuthUser], [useAuth.ts:AUTH_QUERY_KEY]
- `useConnectionStatus(onReconnect?)` → `ConnectionStatus` [useConnectionStatus.ts:useConnectionStatus]
- `useGameTable(gameRoomCode, userId, username, players)` → reducer state (minus the trick queue) plus `currentSignal` (derived from the visible lead card), `notice`, `completedTrick`, `fastCollection`, `gameStateStatus` (`loading` | `ready` | `error`), `refetchGameState`, `setRequestsEnabled(enabled)`, `applyLocalBriscola(suit)` [useGameTable.ts:useGameTable]
- `useMobileTable()` → `true` while `(orientation: landscape) and (max-height: 540px) and (pointer: coarse)` matches; used by `GameTable` for the mobile live-table layout [useMobileTable.ts:useMobileTable]
- `useLobbyRooms(userId)` → `{ availableRooms, activeGames, isLoading, pausedPracticeGames, ordinaryActiveGames, refreshRooms(showLoading?) }` [useLobbyRooms.ts:useLobbyRooms]
- `useReducedMotion()` → `true` while `(prefers-reduced-motion: reduce)` matches; used by `ArcadeLobby`, `GameBoard`, `PreviewStudio` and `MobilePreview` [useReducedMotion.ts:useReducedMotion]
- `useRoundDeal(deal, enabled)` → `RoundDealView` (`phase`, `dealtCards`, `startedAt`, `animationMs`) [useRoundDeal.ts:useRoundDeal]
- `useTurnCountdown(turnTimer)` → seconds remaining or `null` [useTurnCountdown.ts:useTurnCountdown]
- `useWaitingRoom({ roomCode, userId, username, onLoadError, onLeaveError })` → `{ room, isLoading, gameStarted, connectionStatus, leaveWaitingRoom(), configureBots(tier), setPlayerTeam(userId, team), setPlayerReady(userId, isReady) }`; `setPlayerTeam` and `setPlayerReady` only dispatch local reducer updates and make no REST call [useWaitingRoom.ts:useWaitingRoom]

## Invariants
- Auth: `GET /users/me` returning 401/403 means "logged out" (`user: null`), any other error surfaces as `error`; no retries, 5-minute stale time [useAuth.ts:fetchCurrentUser], [useAuth.ts:useAuth]
- When the cached user id changes after a previous one was known (login, logout or account switch), `useAuth` calls `disconnectSocket()` so the next socket handshake carries the new identity [useAuth.ts:useAuth]
- `logout()` tolerates 401/403 from `POST /users/logout`, clears the cached user, then navigates to `/` with `replace` [useAuth.ts:useAuth]
- `onReconnect` fires only on a `connected` status that follows a disconnect after a previous connection [useConnectionStatus.ts:useConnectionStatus]
- `useGameTable` drops stale responses with request sequence counters and an `AbortController`; `setRequestsEnabled(false)` aborts all requests until re-enabled, which triggers a refetch [useGameTable.ts:useGameTable]
- Playable cards are requested only when the game is not paused, the local seat is not bot-controlled, no completed trick is queued, briscola is set, a hand number exists, fewer than 4 cards are on the table, and it is the local user's turn [useGameTable.ts:useGameTable]
- A completed trick stays visible for 3000 ms (1000 ms when `fastCollection`: last trick, a new round, or a finished game), then is released and state is refetched; while visible, turn, timer and playable cards are hidden [useGameTable.ts:useGameTable]
- `turn_timer_started` is anchored on the client receipt time (`Date.now()`), not the server clock [useGameTable.ts:useGameTable]
- `notice` messages come from `new_round_started`, `player_disconnected`, `auto_played` and `player_control_changed`, and clear after 8000 ms [useGameTable.ts:useGameTable]
- `card_played`, `turn_timer_started` and `game_finished` discard an in-flight state snapshot that predates them and replace it with a refetch 300 ms later; `briscola_chosen` always invalidates pending snapshots and schedules a 300 ms refetch (the event lacks the opening hand number) [useGameTable.ts:useGameTable]
- Playable cards are re-requested after every snapshot, because `state_fetched` replaces `myCards` and clears playable cards [useGameTable.ts:useGameTable]
- `practice_abandoned` for the current room calls `setRequestsEnabled(false)` and cancels scheduled refetches; `practice_paused` and `practice_resumed` refetch state [useGameTable.ts:useGameTable]
- `useLobbyRooms` refreshes rooms silently (`refreshRooms(false)`) on every lobby socket `connect` (including reconnects) and after each `practice_*` lobby event [useLobbyRooms.ts:useLobbyRooms]
- `useLobbyRooms` ignores out-of-order `/rooms/available` responses and clears rooms when there is no user [useLobbyRooms.ts:useLobbyRooms]
- `useWaitingRoom` loads `GET /rooms/:code`; on `403` (an invite link opened by a non-member) it calls `POST /rooms/join` and loads again. Socket handlers are registered only after the room has loaded [useWaitingRoom.ts:useWaitingRoom]
- `useWaitingRoom` deduplicates concurrent leave requests per `userId:roomCode` and sends `{ onlyIfWaiting: true }`; a 409 on leave marks the game as started [useWaitingRoom.ts:useWaitingRoom]
- On unmount before the game starts, `useWaitingRoom` always leaves the socket room, but calls `POST /rooms/:code/leave` only on an actual route change and when the initial load did not fail [useWaitingRoom.ts:useWaitingRoom]
- `useRoundDeal` returns `{ phase: "ready", dealtCards: 10 }` when disabled or without a deal; phases run `collecting` → `dealing` → `reviewing` → `ready` against `deal.readyAt` [useRoundDeal.ts:useRoundDeal]
- `useReducedMotion` and `useMobileTable` return `false` when `window.matchMedia` is unavailable [useReducedMotion.ts:useReducedMotion], [useMobileTable.ts:useMobileTable]
- `useAppUpdate` does nothing outside production builds. It checks on mount, every 60 s and on `visibilitychange`, skips hidden documents, and compares `version` with the build-time `import.meta.env.VITE_APP_VERSION`. On mismatch it shows one persistent toast (`id: "app-update"`, "Aggiornamento disponibile") whose "Ricarica" action reloads the page, then stops notifying [useAppUpdate.ts:useAppUpdate]
- `useTurnCountdown` returns `null` for bot turns (`totalMs === null`) and never goes below 0 [useTurnCountdown.ts:useTurnCountdown]

## Side Effects
- REST via `src/lib/api.ts`: `GET /users/me`, `POST /users/logout` [useAuth.ts:useAuth]; `GET /games/:code/state`, `GET /games/playable-cards/:code` [useGameTable.ts:useGameTable]; `GET /rooms/available` [useLobbyRooms.ts:useLobbyRooms]; `GET /rooms/:code`, `POST /rooms/join`, `POST /rooms/:code/leave`, `POST /rooms/:code/bots` [useWaitingRoom.ts:useWaitingRoom]; `fetch("/version.json", { cache: "no-store" })` outside `src/lib/api.ts` [useAppUpdate.ts:useAppUpdate]
- Socket.IO room join: `useGameTable` and `useWaitingRoom` call `registerRoomHandlers`, which emits `join_room` on each socket `connect`; every successful join refetches game state (`useGameTable`) or `GET /rooms/:code` (`useWaitingRoom`) [useGameTable.ts:useGameTable], [useWaitingRoom.ts:useWaitingRoom]
- Socket.IO (room) subscriptions in `useGameTable`: `card_played`, `briscola_chosen`, `new_round_started`, `game_finished`, `player_disconnected`, `turn_timer_started`, `auto_played`, `player_control_changed`, `practice_paused`, `practice_resumed`, `practice_abandoned`; cleanup calls `leaveRoom(code)` [useGameTable.ts:useGameTable]
- Socket.IO (room) subscriptions in `useWaitingRoom`: `player_joined`, `player_left`, `team_chosen`, `ready_changed`, `room_settings_changed`, `game_started` [useWaitingRoom.ts:useWaitingRoom]
- Socket.IO (lobby) subscriptions in `useLobbyRooms`: `room_created`, `room_updated`, `room_full`, `room_deleted`, `practice_paused`, `practice_resumed`, `practice_abandoned`; cleanup calls `leaveLobby()` [useLobbyRooms.ts:useLobbyRooms]
- TanStack Query cache writes for the auth user, router navigation, and `disconnectSocket()` on user change [useAuth.ts:useAuth]
- `sonner` update toast, `window.location.reload()` from its action, and `console.warn` on failed version checks [useAppUpdate.ts:useAppUpdate]
- `sonner` toast and `console.error` on lobby load failure; `console.error` on game-state and playable-card failures [useLobbyRooms.ts:useLobbyRooms], [useGameTable.ts:useGameTable]
- `useReducedMotion` and `useMobileTable` add and remove a `matchMedia` `change` listener [useReducedMotion.ts:useReducedMotion], [useMobileTable.ts:useMobileTable]; `useAppUpdate` adds and removes a document `visibilitychange` listener [useAppUpdate.ts:useAppUpdate]
- Timers (`setTimeout` / `setInterval`) in `useGameTable`, `useRoundDeal`, `useTurnCountdown`, `useAppUpdate` [useRoundDeal.ts:useRoundDeal], [useTurnCountdown.ts:useTurnCountdown], [useAppUpdate.ts:useAppUpdate]

## Verification
- Run: `cd frontend && npx vitest run src/__tests__/hooks src/__tests__/useAppUpdate.test.ts`
- Run: `cd frontend && npm run typecheck && npm run lint`
