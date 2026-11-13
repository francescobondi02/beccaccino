# Domain

## Overview

Shared domain definitions that do not depend on HTTP, Socket.IO, or runtime
state. Direct files define reusable data shapes; the `game/` subdirectory holds
the pure Beccaccino rules.

## Interface

- `publicPlayer.ts`
  - `PUBLIC_PLAYER_SELECT`: Prisma `PlayerSelect` for player data that may be
    sent to clients: `id`, `userId`, `seat`, `team`, `isReady`, `botModel`,
    `abandonedAt`, and `user { id, username }`. Used by room queries, room
    operations, leave, and the room socket handlers.
- [`./game/README.md`](./game/README.md): pure card vocabulary, legal cards,
  trick winner, cricca, caller and turn order, round and game scoring.

## Invariants

- Public player payloads include only the fields listed in
  `PUBLIC_PLAYER_SELECT`; they never include cards, `timeoutCount`, or user
  credentials (`publicPlayer.ts:PUBLIC_PLAYER_SELECT`).
- Rule functions in `game/` are pure (see the child contract).

## Side Effects

- None. `publicPlayer.ts` only declares a constant (type-only Prisma import).

## Verification

- Run: `cd backend && npm run test:unit`
- Run: `cd backend && npm run typecheck`
