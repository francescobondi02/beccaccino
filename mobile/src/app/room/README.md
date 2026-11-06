# Waiting room route (`/room/[code]`)

## Overview
Expo Router screen for a multiplayer room before the deal. Players pick a team,
choose a bot tier for empty seats, mark themselves ready and share the room
code. REST is the source of truth; socket events only trigger a reload. When
the game starts, the screen replaces itself with `/game/[code]`.

## Interface
- `RoomScreen` (default export) `[[code].tsx:RoomScreen]`: validates the `code` param with `/^[A-Za-z0-9]{6,12}$/` and requires a `signedIn` session before rendering `WaitingRoomView`. An invalid code offers "Torna a Gioca" (`/play`); a valid code without a session offers "Accedi" (`/account`).
- `WaitingRoomView` (internal) `[[code].tsx:WaitingRoomView]`: loads `GET /api/rooms/${code}` with `readWaitingRoom` and emits `join_room` with `{ roomCode, userId, username }` through `useSocketRefresh`.
- `Slot` (internal) `[[code].tsx:Slot]`: one seat, either a player, a bot placeholder, an empty seat or a "Siediti qui" button. The button appears only on an empty seat when `onSit` is set.
- Socket events that trigger a reload: `roomEvents` = `player_joined`, `player_left`, `player_disconnected`, `team_chosen`, `ready_changed`, `room_settings_changed`, `game_started` `[[code].tsx:roomEvents]`.
- REST mutations through `act` `[[code].tsx:WaitingRoomView]`:
  - `POST /api/rooms/${code}/choose-team` with `{ team }`.
  - `POST /api/rooms/${code}/bots` with `{ tier }` (`null` or one of `botTiers`).
  - `POST /api/rooms/${code}/ready` with `{ isReady }`, using `botStartTimeoutMs`.
  - `POST /api/rooms/${code}/leave` with `{ onlyIfWaiting: true }`, sent only after the "Uscire dalla stanza?" `GameDialog` is confirmed.
- Navigation targets: `/game/${code}`, `/play`, `/account` `[[code].tsx:WaitingRoomView]`, `[[code].tsx:RoomScreen]`.

## Invariants
- Only one mutation runs at a time: `act` returns `false` while `busy` `[[code].tsx:WaitingRoomView]`.
- After every mutation, success or failure, the room is reloaded before the error is shown `[[code].tsx:WaitingRoomView]` (`act`).
- Overlapping loads are guarded by `latestOnly`; only the newest response updates state `[[code].tsx:WaitingRoomView]` (`load`).
- A loaded room with `started === true`, or a `game_started` event, navigates to `/game/${code}` `[[code].tsx:WaitingRoomView]`.
- A leave rejected with HTTP 409 means the game already started; the screen then opens the table `[[code].tsx:WaitingRoomView]` (`leave`).
- Team changes are offered only when the viewer is in the room, not already in that team (`me.team !== team`), not ready and not busy `[[code].tsx:WaitingRoomView]` (`onSit`).
- A bot-tier chip posts `/bots` only when its tier differs from `room.botTier` `[[code].tsx:WaitingRoomView]`.

## Side Effects
- HTTP requests through `sessionRequest`; all are aborted on unmount through the `lifetime` `AbortController` `[[code].tsx:WaitingRoomView]`.
- Socket.IO connection and `join_room` emit through `useSocketRefresh` `[[code].tsx:WaitingRoomView]`.
- Native share sheet (`Share.share`) for "Invita amici" `[[code].tsx:WaitingRoomView]`.
- Haptics (`touchFeedback`) on seat taps and on `game_started` `[[code].tsx:Slot]`, `[[code].tsx:WaitingRoomView]`.

## Verification
- Run: `cd mobile && npx jest src/__tests__/practice.test.tsx src/__tests__/navigation.test.tsx`
