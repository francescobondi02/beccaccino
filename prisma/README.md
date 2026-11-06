# Prisma Schema

## Overview

PostgreSQL schema for the backend, defined in `schema.prisma`, and its
migration history. Prisma Client (`prisma-client-js`) is generated from this
schema and used through `../src/db.ts`. Migrations live in `./migrations`
(timestamped folders plus `migration_lock.toml`) and are applied with
`prisma migrate deploy`; they are immutable history and must not be edited.

## Interface

- Datasource `db`: provider `postgresql`, `url = env("DATABASE_URL")`,
  `directUrl = env("DIRECT_URL")`.
- Generator `client`: `prisma-client-js` with binary targets `native`,
  `linux-musl-openssl-3.0.x`, `linux-musl-arm64-openssl-3.0.x`.
- Enums
  - `Suit`: `denara`, `coppe`, `spade`, `bastoni`.
  - `Value`: `asso`, `due`, `tre`, `quattro`, `cinque`, `sei`, `sette`,
    `fante`, `cavallo`, `re`.
- Models
  - `User`: account (`username`, optional `email`, `password`, `googleId`),
    `isBot`, `expertAccessGrantedAt`, `createdAt`, `updatedAt`, `deletedAt`
    (soft delete).
  - `AnnotationScenario`: expert scenario (`code`, `decisionType`,
    `predictedDifficulty`, `importance`, `tags`, JSON `state`, `stateHash`,
    `sourceBatch`, `active`, `createdAt`).
  - `ExpertAnnotation`: one expert response (`userId`, `scenarioId`,
    `scenarioHash`, `selectedSuit`, `selectedValue`, `selectedSignal`,
    `selectedBriscola`, `skipped`, `comment`, `perceivedDifficulty`,
    `responseTimeMs`, `createdAt`, `updatedAt`).
  - `PracticeMatch`: archived practice game (`humanSeat`, `botTier`,
    `completed`, `schemaVersion`, JSON `payload`, `startedAt`, `endedAt`).
  - `Player`: room membership (`seat`, `isReady`, `team`, `botModel`,
    `timeoutCount`, `abandonedAt`, `userId`, `gameRoomId`).
  - `GameRoom`: room (`code`, `started`, `finished`, `isPractice`, `botTier`,
    `pausedAt`, `pauseEpoch`, `createdAt`, `lastActivityAt`).
  - `Round`: round state (`number`, `briscola`, `briscolaAutoChosen`,
    `cricca`, `winnerTeam`, `team0Points`, `team1Points`, `team0Figures`,
    `team1Figures`, `createdAt`).
  - `Hand`: one trick (`number`, `roundId`, `starterId`, `winnerId`,
    `createdAt`).
  - `PlayedCard`: a card played into a trick (`handId`, `playerId`, `suit`,
    `value`, `position`, `signal`, `autoPlayed`).
  - `PlayerCard`: a card still held by a player in a round (`playerId`,
    `roundId`, `suit`, `value`, `inHand`). A held card is represented by the row
    existing; playing a card deletes its row. The backend never writes
    `inHand` (always the default `true`), but serialized rows still carry it
    and the web client filters on it (`frontend/src/game/model.ts`), so dropping
    the column needs a coordinated frontend change first.

## Invariants

- Unique: `User.username`, `User.email`, `User.googleId`, `GameRoom.code`,
  `AnnotationScenario.code`, `AnnotationScenario.stateHash`,
  `ExpertAnnotation (userId, scenarioId)`, `Player (gameRoomId, seat)`,
  `Player (gameRoomId, userId)`, `Round (gameRoomId, number)`,
  `Hand (roundId, number)`, `PlayedCard (handId, position)`.
- Indexes: `AnnotationScenario (active, predictedDifficulty)`,
  `ExpertAnnotation (scenarioId)`, `Player (userId)`, `Player (gameRoomId)`,
  `PlayedCard (playerId)`, `PlayerCard (playerId)`, `PlayerCard (roundId)`.
- Relations: `Player` -> `User`, `GameRoom`; `Round` -> `GameRoom`;
  `Hand` -> `Round`; `PlayedCard` -> `Hand`, `Player`; `PlayerCard` ->
  `Player`, `Round`; `ExpertAnnotation` -> `User`, `AnnotationScenario`.
  `Hand.starterId` and `Hand.winnerId` are plain integer player ids without a
  Prisma relation.
- Round scores are stored as real points plus a figures remainder in separate
  columns; raw points are `points * 3 + figures`.
- `Round.briscolaAutoChosen` and `PlayedCard.autoPlayed` are nullable: `null`
  marks rows created before tracking; `true` marks server-chosen moves. New
  rounds also keep `briscolaAutoChosen` `null` until briscola is chosen
  (`../src/game/transitions/round.ts:setBriscolaUnlocked`).
- `Player.botModel` is `null` for a human-controlled seat; `GameRoom.botTier`
  is `null` for humans-only multiplayer rooms.
- `DIRECT_URL` must resolve even locally (it may equal `DATABASE_URL`).

## Side Effects

- `prisma generate` writes the generated client into `node_modules`.
- `prisma migrate deploy` applies pending migrations from `./migrations` to
  the database referenced by `DIRECT_URL`/`DATABASE_URL`.

## Verification

- Run: `cd backend && npx prisma validate`
- Run: `cd backend && npm run typecheck`
