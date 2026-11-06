# Hooks (`src/hooks`)

## Overview
React hooks shared by the screens: live table synchronisation, lobby/room
socket refresh, card dragging, game announcements, reduced-motion preference
and close navigation. REST is the source of truth for game and room state;
Socket.IO events only trigger a reload.

## Interface
- `useLiveGame(code, user)` (default export) `[useLiveGame.ts:useLiveGame]`: returns `{ snapshot, connection, error, needsLogin, busy, syncing, completedTrick, finishCollection, refresh, mutate }`. `snapshot` is `{ room, game, playable, receivedAt }`; `connection` is `'connecting' | 'ready' | 'offline'`.
  - REST reads: `GET /api/rooms/${code}` (first snapshot only), `GET /api/games/${code}/state`, `GET /api/games/playable-cards/${code}` (only when the viewer can play).
  - Socket: emits `join_room` with `{ roomCode, userId, username }` and an 8-second acknowledgement timeout; reloads on `gameEvents` = `card_played`, `briscola_chosen`, `new_round_started`, `round_ended`, `game_finished`, `turn_timer_started`, `auto_played`, `player_control_changed`, `practice_paused`, `practice_resumed`, `practice_abandoned` `[useLiveGame.ts:gameEvents]`.
  - `mutate(path, body)` sends one POST through `sessionRequest`, then refreshes.
  - `refresh()` re-fetches when joined, reconnects the socket when not joined, and restarts the whole effect (increments `attempt`) when no socket exists yet.
- `useSocketRefresh(join, events, refresh, onEvent?)` (default export) `[useSocketRefresh.ts:useSocketRefresh]`: opens a socket, calls `join(socket)` on each connect, and calls `refresh` (debounced 150 ms) on connect and on any event in `events`; returns `{ online }`.
- `useCardDrag(enabled, onDrop, onDrag?)` (default export) `[useCardDrag.ts:useCardDrag]`: `PanResponder` handlers and an `Animated.ValueXY` offset; releasing a card dragged up by 70 points or more (`dy <= -dropDistance`, `dropDistance` = 70) calls `onDrop`.
- `useGameAnnouncements(snapshot, completedTrick, userId)` (default export) `[useGameAnnouncements.ts:useGameAnnouncements]`: returns `{ announcement, done }`; types `Tone` and `Announcement` `[useGameAnnouncements.ts:Announcement]`.
- `useReducedMotion()` (default export) `[useReducedMotion.ts:useReducedMotion]`: `boolean | null` (`null` until the system preference is known).
- `useCloseOrHome()` (default export) `[useCloseOrHome.ts:useCloseOrHome]`: returns a function that calls `router.back()` when possible, otherwise `router.replace('/')`.

## Invariants
- `useLiveGame` rejects a snapshot when the viewer is not in the room, or when played cards or the last trick reference unknown players. The error is caught by `report`, which sets `error` (and `needsLogin` on HTTP 401); it never reaches the caller `[useLiveGame.ts:useLiveGame]` (`refresh`, `report`).
- `useLiveGame` reads the room once: later refreshes reuse `latest.room`, so membership changes are not re-read until the effect restarts `[useLiveGame.ts:useLiveGame]` (`refresh`).
- `useLiveGame` discards a fetched snapshot when a socket event or reconnect changed `revision` during the fetch, and fetches again while `dirty` `[useLiveGame.ts:useLiveGame]` (`refresh`).
- `useLiveGame` runs one mutation at a time and never resends a failed POST; it refreshes to reconcile, then reports the error `[useLiveGame.ts:useLiveGame]` (`mutate`).
- `useLiveGame` sets `needsLogin` on HTTP 401 or on socket `connect_error` messages in `authFailures` `[useLiveGame.ts:useLiveGame]`.
- `useLiveGame` requests a pause (`POST /api/rooms/${code}/pause`) on `background` only for practice rooms that are not already `paused` or `finished` `[useLiveGame.ts:useLiveGame]`.
- `completedTrick` is set only when `lastCompletedTrick` changes after the first snapshot (key `roundId:handNumber`) `[useLiveGame.ts:useLiveGame]`.
- Socket hooks connect only while `AppState` is `active` and disconnect otherwise `[useLiveGame.ts:useLiveGame]`, `[useSocketRefresh.ts:useSocketRefresh]`.
- On a socket `connect_error` not in `authFailures`, both socket hooks retry after 5 seconds when the socket is inactive `[useLiveGame.ts:useLiveGame]`, `[useSocketRefresh.ts:useSocketRefresh]`.
- After an authentication failure `useSocketRefresh` disconnects and does not schedule a retry; the `AppState` listener still calls `socket.connect()` on the next transition to `active` `[useSocketRefresh.ts:useSocketRefresh]`.
- `useSocketRefresh` silently ignores `openSocket()` failures (for example no saved credentials); `online` then stays `false` with no error `[useSocketRefresh.ts:useSocketRefresh]`.
- `useCardDrag` claims the gesture only after more than 8 points of movement while `enabled`, so taps and long presses still reach the card; if `onDrop` resolves `false`, the card springs back `[useCardDrag.ts:useCardDrag]`.
- `useGameAnnouncements` shows each event key once; on first entry only `turn:` and `choose:` prompts are queued `[useGameAnnouncements.ts:useGameAnnouncements]`.
- `useGameAnnouncements` does not prompt the viewer while the seat is bot-controlled or a trick is being collected `[useGameAnnouncements.ts:events]`.
- `useReducedMotion` falls back to `true` if the preference query fails, and ignores the initial query once a change event arrives `[useReducedMotion.ts:useReducedMotion]`.

## Side Effects
- Backend HTTP requests through `sessionRequest` `[useLiveGame.ts:useLiveGame]`.
- Socket.IO connections through `openSocket`, cleaned up on unmount `[useLiveGame.ts:useLiveGame]`, `[useSocketRefresh.ts:useSocketRefresh]`.
- `AppState` and `AccessibilityInfo` subscriptions `[useLiveGame.ts:useLiveGame]`, `[useSocketRefresh.ts:useSocketRefresh]`, `[useReducedMotion.ts:useReducedMotion]`.
- Timers for debounced reloads and reconnect retries `[useLiveGame.ts:useLiveGame]`, `[useSocketRefresh.ts:useSocketRefresh]`.
- Haptics on drag start (`touchFeedback`) `[useCardDrag.ts:useCardDrag]`.
- Logs a warning when the reduced-motion query fails `[useReducedMotion.ts:useReducedMotion]`.
- Navigation through `expo-router` `[useCloseOrHome.ts:useCloseOrHome]`.

## Verification
- No direct hook tests; the hooks are exercised by the screen tests. Run: `cd mobile && npx jest src/__tests__`
