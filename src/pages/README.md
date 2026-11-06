# Pages

## Overview
Route-level screens of the live interface. Pages adapt the route and
authentication, run user commands through REST, and compose views from
`src/components/`; long-lived socket and state coordination is delegated to
`src/hooks/`. Routes are declared in `src/App.tsx`.

## Interface
All pages are default exports:
- `LobbyPage` (`/`) — arcade lobby with create/join/practice actions and live room lists [LobbyPage.tsx:LobbyPage]
- `GameRoom` (`/room/:roomCode`) — waiting room: team choice, ready toggle, bot tier, invite link, leave [GameRoom.tsx:GameRoom]
- `GameTable` (`/game/:gameRoomCode`) — live table, dialogs, practice controls, final result [GameTable.tsx:GameTable]
- `Practice` (`/practice`) — starts a practice game against bots [Practice.tsx:Practice]
- `Profile` (`/profile`; optional prop `preview`) — username edit, stats, recent games, account deletion; also exports `UserStats` [Profile.tsx:Profile], [Profile.tsx:UserStats]
- `Leaderboard` (`/leaderboard`) — podium and ranking list [Leaderboard.tsx:Leaderboard]
- `Annotation` (`/annotate`) — expert access gate and scenario labeling [Annotation.tsx:Annotation]
- `NotFound` (`*`) — Italian 404 page [NotFound.tsx:NotFound]

## Invariants
- `GameRoom`, `GameTable`, `Practice` and `Profile` (non-preview) call `useAuth({ redirectOnFail: true })`; auth errors render `AuthErrorState`, as they do in `LobbyPage` [GameRoom.tsx:GameRoom], [GameTable.tsx:GameTable], [Practice.tsx:Practice], [Profile.tsx:Profile], [LobbyPage.tsx:LobbyPage]
- `Annotation` does not render `AuthErrorState`: an auth error sets its own generic `error` status with an auth retry target [Annotation.tsx:Annotation]
- `LobbyPage` opens the auth dialog instead of acting when the visitor is not logged in; an empty trimmed room code shows a toast and does not call the API [LobbyPage.tsx:LobbyPage]
- Create/join/practice 409 conflicts with `activeRoomCode` redirect to that game via `handleActiveRoomConflict` [LobbyPage.tsx:LobbyPage], [Practice.tsx:Practice]
- `GameRoom` allows choosing a team only while the player has none and that team has fewer than 2 players; the ready button requires a team; when the game starts it navigates to `/game/:roomCode` [GameRoom.tsx:GameRoom]
- The `GameRoom` bot-tier `<select>` offers none, `facile`, `medio`, `forte` and `esperto`, and is disabled while updating or once the room has started; a 503 from ready shows "Bot non disponibili. Riprova tra poco." [GameRoom.tsx:GameRoom]
- `GameRoom` falls back to a manual-copy invite dialog when the clipboard API is missing or fails [GameRoom.tsx:GameRoom]
- `GameTable` redirects to `/room/:code` if the room has not started, and to `/` when the local seat is abandoned or the practice is abandoned [GameTable.tsx:GameTable]
- In `GameTable`, a trick leader (no cards on the table) must pass through `SignalDialog` before the card is sent; followers play immediately; a card is sent only if it is the user's turn, not already sending, and the card is in `playableCards` [GameTable.tsx:GameTable]
- `GameTable` opens the briscola dialog only for the human caller, when not paused, no trick is being collected, the deal phase is `ready`, cards are in hand, no round summary is shown, and the game is not finished [GameTable.tsx:GameTable]
- `GameTable` shows `GameResult` only after any completed trick is released [GameTable.tsx:GameTable]
- Leaving a finished multiplayer game does not call the leave endpoint; a 404 on practice leave is ignored [GameTable.tsx:cleanupRoom]
- `Practice` requests fullscreen before the API call (user activation) and exits fullscreen on failure; it always requests tier `"forte"` [Practice.tsx:Practice]
- `Profile` requires a trimmed username of at least 3 characters; preview mode is honoured only in `import.meta.env.DEV` and uses `profileDemo` instead of API data. `profileDemo` is imported statically from `src/preview/profileDemo.ts`, so it ships in production builds [Profile.tsx:Profile]
- `Annotation` normalizes legacy scenarios without `decisionType` to `play_card`; 401 clears the user and reopens login, 403 shows the access-code form; a 409 on submit marks the scenario stale [Annotation.tsx:normalizeScenario], [Annotation.tsx:Annotation]
- `Annotation` access-code errors: an empty trimmed code shows "Inserisci il codice di accesso." without a request; 400, 429 and 503 map to specific messages, other failures to a generic retry message [Annotation.tsx:Annotation]

## Side Effects
- REST via `src/lib/api.ts`:
  - `LobbyPage`: `POST /rooms`, `POST /rooms/join`, `POST /rooms/:code/resume` [LobbyPage.tsx:LobbyPage]
  - `GameRoom`: `POST /rooms/:code/ready`, `POST /rooms/:code/choose-team` (room load, leave and bots via `useWaitingRoom`) [GameRoom.tsx:GameRoom]
  - `GameTable`: `GET /rooms/:code`, `POST /games/play-card`, `POST /games/choose-briscola`, `POST /rooms/:code/leave`, `POST /rooms/:code/pause`, `POST /rooms/:code/resume`, `POST /rooms/:code/resume-control` [GameTable.tsx:GameTable]
  - `Practice`: `POST /rooms/practice` [Practice.tsx:Practice]
  - `Profile`: `GET /users/me/stats`, `PATCH /users/me`, `DELETE /users/me` [Profile.tsx:Profile]
  - `Leaderboard`: `GET /users/leaderboard` [Leaderboard.tsx:Leaderboard]
  - `Annotation`: `GET /annotations/status`, `GET /annotations/next`, `POST /annotations/access`, `POST /annotations/responses` [Annotation.tsx:Annotation]
- Socket.IO: `GameTable` subscribes to `player_left` and `practice_abandoned` (other game events via `useGameTable`) [GameTable.tsx:GameTable]
- Fullscreen: `GameTable` listens to `fullscreenchange` and exits fullscreen on unmount; `Practice` enters fullscreen [GameTable.tsx:GameTable], [Practice.tsx:Practice]
- `navigator.clipboard.writeText` for invite links [GameRoom.tsx:GameRoom]
- `NotFound` logs the missing path with `console.error` [NotFound.tsx:NotFound]
- `sonner` toasts and router navigation throughout.

## Verification
- Run: `cd frontend && npx vitest run src/__tests__/pages`
- Run: `cd frontend && npm run typecheck && npm run lint`
