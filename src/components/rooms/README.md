# Room Components

## Overview
Waiting-room presentation. Renders the four slots produced by
`waitingRoomSlots()` in `src/rooms/waitingRoomState.ts`; it is used by
`src/pages/GameRoom.tsx`.

## Interface
- `WaitingRoomPlayers` (default export) — props `{ players: WaitingRoomSlot[]; currentUserId: number | null }` [WaitingRoomPlayers.tsx:WaitingRoomPlayers]

## Invariants
- Each slot is rendered as one of three states: a player (initials, ready state), a bot placeholder (`"isBotPlaceholder" in slot`, label "Bot alla partenza"), or an empty slot (`null`, "In attesa...") [WaitingRoomPlayers.tsx:WaitingRoomPlayers]
- The current user's card gets a ring and a "Tu" badge [WaitingRoomPlayers.tsx:WaitingRoomPlayers]
- The team badge ("Squadra N", 1-based) appears only when `slot.team != null` [WaitingRoomPlayers.tsx:WaitingRoomPlayers]
- Initials are at most two uppercase characters [WaitingRoomPlayers.tsx:initials]

## Side Effects
- None.

## Verification
- Run: `cd frontend && npx vitest run src/__tests__/pages/GameRoom.test.tsx src/__tests__/rooms/waitingRoomState.test.ts`
- Run: `cd frontend && npm run typecheck && npm run lint`
