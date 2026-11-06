# Practice Match Payload

## Overview

Versioned JSON contract for archived practice games. The same types and parser
are used when `../services/practiceArchive.ts` builds a `PracticeMatch.payload`
and when `../scripts/exportPracticeMatches.ts` exports archived games as JSONL
for offline training.

## Interface

- `matchPayload.ts`
  - `PRACTICE_MATCH_PAYLOAD_VERSION` (`1`).
  - Types `PracticeSeat` (`0 | 1 | 2 | 3`), `PracticeCardCode`
    (`` `${Suit}:${Value}` ``), `PracticeCardEntry` (`[seat, card]`),
    `PracticeHumanAction`, `PracticeTrickPayload`, `PracticeRoundPayload`,
    `PracticeMatchPayload` (`{ winPoints, rounds }`).
  - `parsePracticeMatchPayload(value)`: strict parser returning a
    `PracticeMatchPayload` or throwing an `Error` with the offending path.

## Invariants

- Every object must contain exactly its declared keys (`exactKeys` from
  `../utils/json.ts`).
- `rounds` is non-empty and chronological (`round.number === index + 1`);
  `winPoints` is an integer of at least 1
  (`matchPayload.ts:parsePracticeMatchPayload`).
- Each round has a boolean `cricca`, nullable `briscola`, `callerSeat` from 0
  to 3, `dealtHands` with exactly keys `"0"` to `"3"` holding ten card codes
  each, at most ten tricks, and a `humanActions` array
  (`matchPayload.ts:roundAt`, `dealtHandsAt`).
- Each trick has one to four `[seat, "suit:value"]` entries, a nullable
  `winnerSeat`, and a nullable signal from `CARD_SIGNALS`
  (`matchPayload.ts:trickAt`).
- Human actions are either `{ kind: "choose_briscola", suit }` or
  `{ kind: "play_card", trick >= 1, position 0-3, card, signal }`
  (`matchPayload.ts:humanActionAt`).
- Card codes must be a valid Prisma `Suit` and `Value` joined by `:`
  (`matchPayload.ts:cardCodeAt`).

## Side Effects

- None. The module is pure.

## Verification

- Run: `cd backend && npx jest tests/unit/practiceMatchPayload.test.ts tests/unit/practiceArchive.test.ts`
