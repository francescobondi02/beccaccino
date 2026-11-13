# Game

## Overview

Persisted game flow on top of the pure rules in `../domain/game`. The direct
file defines the shared turn phase and exact turn identity used to fence
runtime moves; `snapshots/` derives the current caller and turn from the
database without side effects; `transitions/` performs the atomic round,
briscola, and card-play mutations.

## Interface

- `turn.ts`
  - type `TurnPhase`: `"play_card" | "choose_briscola"`.
  - type `TurnIdentity`: `{ roundId, handId, playedCardCount }`.
  - `isSameTurn(first, second)`: field-by-field equality of two identities.
- [`./snapshots/README.md`](./snapshots/README.md): `readCallerPlayerId`,
  `readCurrentTurn`, `readCurrentTurnUserId`.
- [`./transitions/README.md`](./transitions/README.md): `startFirstRound`,
  `setupRound`, `setBriscola`, `playCard`, `claimPracticeTransition`,
  `assertPlayerControl`, `PracticeTurnCancelledError`,
  `RuntimeTurnCancelledError`.

## Invariants

- A turn is identified exactly by round id, current trick (`Hand`) id, and the
  number of cards already played in that trick; two identities are the same
  turn only if all three fields match (`turn.ts:isSameTurn`). Briscola turns
  use `handId: null` and `playedCardCount: 0`.
- Snapshot reads never write, start timers, or run bots; transitions commit
  their database writes before starting or clearing runtime (see child
  contracts).

## Side Effects

- `turn.ts`: none (pure).
- Database reads (`snapshots/`), database writes, runtime timer/bot handoff,
  and Socket.IO publication (`transitions/`) as documented in the child
  contracts.

## Verification

- Run: `cd backend && npx jest tests/integration/runtimeIdentity.test.ts tests/integration/gameStart.test.ts --runInBand`
  (needs the `becca_test` PostgreSQL database)
- Run: `cd backend && npm run typecheck`
