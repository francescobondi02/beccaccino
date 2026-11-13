# Game Snapshots

## Overview

Read-only queries that derive the persisted round caller and the exact current
turn from Prisma rows. They compose the pure rules in
`../../domain/game/turnOrder.ts` with database reads, and accept an optional
transaction client so callers can read inside the same transaction that they
mutate in.

## Interface

- `turnState.ts`
  - `readCallerPlayerId(round, players, client = prisma)`: the caller's
    `playerId` for `round`, or `null`.
  - `readCurrentTurn(round, players, callerPlayerId, client = prisma)`:
    `{ userId, phase, identity }` or `null`, where `phase` is a `TurnPhase`
    and `identity` is a `TurnIdentity` from `../turn.ts`.
  - `readCurrentTurnUserId(round, players, callerPlayerId, client = prisma)`:
    the `userId` from `readCurrentTurn`, or `null`.
  - The `client` parameter is limited to the `hand`, `playerCard`, and `round`
    delegates of `Prisma.TransactionClient` (`GameReadClient`).

## Invariants

- The caller is the starter of the round's first trick (`Hand` with the lowest
  `number`) when one exists. Otherwise round 1 uses the holder of quattro di
  denara, and later rounds advance one seat from the previous round's first
  trick starter (`turnState.ts:readCallerPlayerId`).
- `phase` is `"choose_briscola"` while `round.briscola` is `null`, otherwise
  `"play_card"` (`turnState.ts:readCurrentTurn`).
- During `choose_briscola`, the identity is
  `{ roundId, handId: null, playedCardCount: 0 }`; during `play_card`, it is
  the latest `Hand` id and its played-card count
  (`turnState.ts:readCurrentTurn`).
- Returns `null` when no player occupies the resolved turn seat.

## Side Effects

- Database reads only (Prisma `hand.findFirst`, `playerCard.findFirst`,
  `round.findFirst`). No writes, timers, bots, or socket events.

## Verification

- Run: `cd backend && npx jest tests/integration/practicePause.test.ts` (needs
  the `becca_test` PostgreSQL database)
- Run: `cd backend && npm run typecheck`
