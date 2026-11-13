# Rooms

## Overview
Room DTOs, normalization, and pure reducers for the lobby room lists and the
waiting room. Consumed by `src/hooks/useLobbyRooms.ts`,
`src/hooks/useWaitingRoom.ts` and related views.

## Interface
- `RoomPlayerResponse`, `RoomPlayer`, `Room`, `RoomResponse` [model.ts:RoomPlayer], [model.ts:Room], [model.ts:RoomResponse]
- `normalizeRoomPlayer(player)`, `normalizeRoom(room)` [model.ts:normalizeRoomPlayer], [model.ts:normalizeRoom]
- `LobbyRoomPlayer`, `LobbyRoom` (extends the socket `LobbyRoom` from `src/sockets/events.ts` with `isPractice?`, `pausedAt?`, `started?`, `players?`), `LobbyRoomsResponse`, `LobbyRoomsState`, `LobbyRoomsAction` [lobbyState.ts:LobbyRoom], [lobbyState.ts:LobbyRoomsAction]
- `initialLobbyRoomsState`, `lobbyRoomsReducer(state, action)`, `splitActiveGames(activeGames)` [lobbyState.ts:lobbyRoomsReducer], [lobbyState.ts:splitActiveGames]
- `WaitingRoomState`, `WaitingRoomAction`, `initialWaitingRoomState`, `waitingRoomReducer(state, action)` [waitingRoomState.ts:waitingRoomReducer]
- `WaitingRoomSlot` (`RoomPlayer` | `{ isBotPlaceholder: true; team }` | `null`), `waitingRoomSlots(room, currentUserId)` [waitingRoomState.ts:WaitingRoomSlot], [waitingRoomState.ts:waitingRoomSlots]

## Invariants
- `normalizeRoomPlayer` takes `username` from `player.username`, then `player.user.username`, else "Sconosciuto"; `botModel` and `abandonedAt` are copied only when defined [model.ts:normalizeRoomPlayer]
- REST lobby rooms are converted with `currentPlayers = players.length` (or 0) and `maxPlayers = 4` [lobbyState.ts:toLobbyRoom]
- `rooms_loaded` replaces both lists (copying `isPractice`, `pausedAt` and `started` onto active games) and clears loading; `rooms_cleared` resets to the initial state [lobbyState.ts:lobbyRoomsReducer]
- Socket room create/update/remove actions touch only `availableRooms`; practice pause/resume/abandon actions touch only `activeGames` [lobbyState.ts:lobbyRoomsReducer]
- `splitActiveGames` puts a game in `pausedPracticeGames` only when `isPractice && pausedAt`; everything else is `ordinaryActiveGames` [lobbyState.ts:splitActiveGames]
- `player_joined` ignores a user already in the room; team/ready updates apply only to the matching `userId` [waitingRoomState.ts:waitingRoomReducer]
- `waitingRoomSlots` always returns exactly 4 slots: the current user first, other players by username, then bot placeholders when `room.botTier` is set (empty `null` slots otherwise); placeholders get the missing team positions only when every player has a team [waitingRoomState.ts:waitingRoomSlots]

## Side Effects
- None. All exports are types, constants or pure functions.

## Verification
- Run: `cd frontend && npx vitest run src/__tests__/rooms`
- Run: `cd frontend && npm run typecheck && npm run lint`
