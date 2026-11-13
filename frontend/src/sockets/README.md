# Sockets

## Overview
Typed Socket.IO client layer: the event contract, a singleton connection with
status tracking, and helpers for lobby and room subscriptions. Hooks and a few
pages build on these helpers; game mutations go through REST, not sockets.

## Interface
- Contract types: `ServerToClientEvents`, `ClientToServerEvents`, and payloads (`CardPlayedPayload`, `BriscolaChosenPayload`, `GameFinishedPayload`, `NewRoundStartedPayload`, `TurnTimerStartedPayload`, `AutoPlayedPayload`, `PlayerControlChangedPayload`, `PracticePausedPayload`, `ChatMessagePayload`, `RoundEndedPayload`, `LobbyRoom`, `Phase`, `Player`, `TeamScore`, `JoinRoomResult`, …) [events.ts:ServerToClientEvents], [events.ts:ClientToServerEvents]
- Server → client events: `room_created`, `room_updated`, `room_full`, `room_deleted`, `player_joined`, `player_left`, `player_disconnected`, `team_chosen`, `ready_changed`, `room_settings_changed`, `game_started`, `new_round_started`, `briscola_chosen`, `card_played`, `round_ended`, `game_finished`, `turn_timer_started`, `auto_played`, `player_control_changed`, `practice_paused`, `practice_resumed`, `practice_abandoned`, `chat_message`, `error` [events.ts:ServerToClientEvents]
- Client → server events: `join_lobby`, `leave_lobby`, `join_room` (with acknowledgement), `leave_room`, `send_chat_message` [events.ts:ClientToServerEvents]
- `AppSocket`, `ConnectionStatus` (`connected` | `disconnected` | `reconnecting`) [socketClient.ts:AppSocket], [socketClient.ts:ConnectionStatus]
- `getSocket()`, `getConnectionStatus()`, `onConnectionStatusChange(listener)`, `disconnectSocket()` [socketClient.ts:getSocket], [socketClient.ts:onConnectionStatusChange], [socketClient.ts:disconnectSocket]
- `registerLobbyHandlers(userId, onReconnect?)`, `leaveLobby()`, `subscribeToLobbyEvent(event, listener)` for `room_created`, `room_updated`, `room_full`, `room_deleted`, `practice_paused`, `practice_resumed`, `practice_abandoned` [lobbyHandlers.ts:registerLobbyHandlers], [lobbyHandlers.ts:LobbyEventName]
- `registerRoomHandlers(roomCode, user, onJoined?)`, `leaveRoom(roomCode)`, `subscribeToRoomEvent(event, listener)` for all server events except lobby list events and `error` [roomHandlers.ts:registerRoomHandlers], [roomHandlers.ts:RoomEventName]

## Invariants
- One shared socket: `getSocket()` creates it once on `window.location.origin`, path `/socket.io/`, transports `["websocket", "polling"]`, `tryAllTransports: true`, `withCredentials: true`, infinite reconnection with 1–5 s backoff and a 20 s timeout [socketClient.ts:getSocket]
- Status listeners are notified only on actual changes; a listener error is logged and does not stop other listeners [socketClient.ts:setStatus]
- `connect_error` handling: "Authentication unavailable" retries after 5 s; "Authentication required" or "Invalid or expired token" disconnects permanently and shows a login toast; other errors report `reconnecting` while the socket is active [socketClient.ts:getSocket]
- An "io server disconnect" sets `disconnected` and reconnects manually; other disconnect reasons report `reconnecting` [socketClient.ts:getSocket]
- Manager events: `reconnect_attempt` sets `reconnecting`; `reconnect_failed` sets `disconnected` [socketClient.ts:getSocket]
- `getConnectionStatus()` silently corrects a stale status to `connected` when the socket is connected, without notifying listeners [socketClient.ts:getConnectionStatus]
- `registerLobbyHandlers` and `registerRoomHandlers` always call `socket.connect()` (a no-op when already connected), so they reopen a socket that was disconnected [lobbyHandlers.ts:registerLobbyHandlers], [roomHandlers.ts:registerRoomHandlers]
- `disconnectSocket()` clears the auth retry timer, disconnects the socket, resets the singleton to `null` so the next `getSocket()` creates a new one, and sets `disconnected`; `useAuth` calls it when the signed-in user changes, because the socket keeps its handshake identity [socketClient.ts:disconnectSocket], [../hooks/useAuth.ts:useAuth]
- `registerLobbyHandlers` emits `join_lobby` immediately and again on every `connect`, then calls `onReconnect` [lobbyHandlers.ts:registerLobbyHandlers]
- `registerRoomHandlers` emits `join_room` only while connected and active, re-joins on every `connect`, calls `onJoined` on `ok`, and retries every 5 s only when the error is "Failed to join room" [roomHandlers.ts:registerRoomHandlers]
- Every `register*` / `subscribe*` returns an unsubscribe function that removes its own listener [lobbyHandlers.ts:subscribeToLobbyEvent], [roomHandlers.ts:subscribeToRoomEvent]

## Side Effects
- Opens and maintains the Socket.IO connection; emits `join_lobby`, `leave_lobby`, `join_room`, `leave_room` [socketClient.ts:getSocket], [lobbyHandlers.ts:leaveLobby], [roomHandlers.ts:leaveRoom]
- `sonner` toasts for server `error` events and expired sessions; the toast action sets `window.location.href = "/"` [socketClient.ts:getSocket]
- `console.error` on connection errors [socketClient.ts:getSocket]

## Verification
- Run: `cd frontend && npx vitest run src/__tests__/socketClient.test.ts src/__tests__/lobbyHandlers.test.ts src/__tests__/roomHandlers.test.ts`
- Run: `cd frontend && npm run typecheck && npm run lint`
