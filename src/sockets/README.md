# Room Sockets

## Overview

Client-to-server Socket.IO handlers for lobby and room presence, room chat,
and AFK control reclaim on rejoin. Room and game mutations (team, ready, bots,
moves) are REST-only; their resulting events are published by services and
transitions through `../runtime/eventPublisher.ts`. Transport authentication
happens earlier in `../server.ts`.

## Interface

- `room.ts`
  - `registerRoomSocket(socket, io)`: registers the handlers below on one
    connected socket.
  - Client events handled:
    - `join_lobby`, `leave_lobby`: join or leave the `lobby` Socket.IO room.
    - `join_room` `({ roomCode }, ack?)`: joins a game room; acknowledges
      `{ ok: true }` or `{ ok: false, error }`.
    - `send_chat_message` `({ message })`.
    - `leave_room` `({ roomCode })`.
    - `disconnecting` (built-in).
  - Server events emitted: `error` `{ message }` (to the socket),
    `player_joined` `{ player }` and `player_disconnected`
    `{ userId, username }` (to other sockets in the room), and `chat_message`
    `{ userId, username, message, timestamp }` (to the whole room).

## Invariants

- Identity comes from `socket.data.user` set by the handshake middleware; the
  payload's `userId`/`username` are used only when no handshake identity
  exists (test bypass) (`room.ts:registerRoomSocket` `join_room`).
- Payload fields are read only from plain objects (`room.ts:field`).
- `join_room` runs under `withRoomLock(roomCode)` and requires that the user is
  a player of the room; a player who abandoned an unfinished game is refused.
- Rejoining a started, unfinished game while `botModel` is set reclaims
  control via `changePlayerControlUnlocked({ action: "resume" })`.
- A socket tracks one game room in `socket.data.roomCode`; joining another
  leaves the previous one. `player_joined` is emitted only if the user had no
  other socket in the room; `player_disconnected` only when the last socket of
  that user in the room disconnects.
- Chat requires an authenticated socket that has joined a room, sends only to
  `socket.data.roomCode` (no cross-room spoofing), is limited to 5 messages
  per 3 seconds per socket, and drops messages that `sanitizeChatMessage`
  reduces to empty.
- Disconnecting never removes, pauses, or abandons a player.

## Side Effects

- Joins and leaves Socket.IO rooms; mutates `socket.data.roomCode` and
  `socket.data.user`.
- Reads `GameRoom`/`Player` via Prisma; may update `Player` control and
  restart runtime through `changePlayerControlUnlocked`.
- Emits the events listed above; logs `join_room_failed`.

## Verification

- Run: `cd backend && npx jest tests/unit/chatSanitization.test.ts`
- Run: `cd backend && npx jest tests/integration/socket.test.ts --runInBand`
  (needs the `becca_test` PostgreSQL database)
