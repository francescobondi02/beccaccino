# HTTP Input Parsers

## Overview

Request-body parsers for room and user endpoints. Each parser accepts an
untyped body, validates the fields one endpoint needs, and returns typed
values or throws a `ClientError` built by `badRequest` from `../errors.ts`
(mapped to HTTP 400 by `../errorHandler.ts`).

## Interface

- `rooms.ts`
  - `parsePracticeTier(body)`: `BotTier` from `body.tier`.
  - `parseRoomBotTier(body)`: `BotTier`, or `null` when `body.tier === null`.
  - `parseJoinRoom(body)`: non-empty `body.roomCode`.
  - `parseReady(body)`: boolean `body.isReady`.
  - `parseTeam(body)`: `0 | 1` from `body.team`.
  - `parseRoomCode(value)`: non-empty room code string.
- `users.ts`
  - `parseRegistrationInput(body)`: `{ username, password, email }`.
  - `parseLoginInput(body)`: `{ username, password }`.
  - `parseUsernameUpdate(body)`: validated username.

## Invariants

- Valid bot tiers are exactly `BOT_TIERS` from `../../services/botUsers.ts`
  (`facile`, `medio`, `forte`, `esperto`); anything else is rejected with the
  allowed list in the message (`rooms.ts:parsePracticeTier`).
- Team selection accepts only the numbers `0` and `1` (`rooms.ts:parseTeam`).
- Registration and username updates use `validateUsername` from
  `../../utils/validateUsername.ts` (trimmed, 3 to 20 characters) and return
  the trimmed value (`users.ts:parseRegistrationInput`,
  `users.ts:parseUsernameUpdate`).
- Registration passwords must have at least 6 characters; `email` must be a
  string when present, and an empty or missing email becomes `null`
  (`users.ts:parseRegistrationInput`).
- Login only checks that username and password are non-empty strings; it does
  not trim or validate the username (`users.ts:parseLoginInput`).

## Side Effects

- None. Parsers are pure and only throw `ClientError` (400).

## Verification

- Run: `cd backend && npx jest tests/unit/httpInput.test.ts`
