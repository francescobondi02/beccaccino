# Live game route (`/game/[code]`)

## Overview
Expo Router screen for a started table, used by both practice (bots) and
multiplayer games. It validates the room code and session, then renders the
shared `LiveTable` with server-authoritative state from `useLiveGame`. All game
mutations go through REST; the socket only signals that state changed.

## Interface
- `GameScreen` (default export) `[[code].tsx:GameScreen]`: reads the `code` route param with `useLocalSearchParams`, requires `/^[A-Za-z0-9]{6,12}$/` and a `signedIn` session, otherwise shows an "Account" button that calls `router.replace('/account')`.
- `GameTable` (internal) `[[code].tsx:GameTable]`: table screen keyed by `${session.user.id}:${code}`. It composes `LiveTable`, `CenterToast`, `ScoreBoard`, `TimerBadge`, `TrickReview`, `SoundToggle` and several `GameDialog`s (briscola choice, menu/pause, last trick, abandon confirmation, round summary, final result).
- REST mutations sent through `useLiveGame().mutate` `[[code].tsx:GameTable]`:
  - `POST /api/games/play-card` with `{ roomCode, suit, value, signal }`.
  - `POST /api/games/choose-briscola` with `{ gameRoomId, suit }`.
  - `POST /api/rooms/${code}/pause`, `POST /api/rooms/${code}/resume` (practice only).
  - `POST /api/rooms/${code}/resume-control` (take back a bot-controlled seat).
  - `POST /api/rooms/${code}/leave` (abandon, and the practice final-result "Torna a Gioca"; on success navigates to `/play`).
- Navigation targets: `/account`, `/play` `[[code].tsx:GameTable]`.
- Session expiry (`needsLogin`): the screen shows "Accedi di nuovo", which calls `retrySession()` and then `router.replace('/account')` `[[code].tsx:GameTable]`.
- Announcements come from `useGameAnnouncements(snapshot, completedTrick, user.id)` and are shown by `CenterToast`; `useReducedMotion()` is treated as reduced unless it is `false` `[[code].tsx:GameTable]`.
- `CenterToast` shows a sticky "RICONNESSIONE…" message whenever `connection !== 'ready'` `[[code].tsx:GameTable]`.

## Invariants
- Only cards present in the server-provided `playable` list are sent; `play` returns `false` otherwise `[[code].tsx:GameTable]` (`play`).
- A leader signal is sent only when `game.playedCards.length === 0`; otherwise `signal: null` `[[code].tsx:GameTable]` (`play`).
- Input is enabled only when `connection === 'ready'` and the screen is not busy, syncing, in error, collecting a trick or presenting a new deal (`enabled`) `[[code].tsx:GameTable]`.
- Card selection and signal choice are bound to `turnKey` (round, hand, turn user, played-card count) and are discarded when the turn changes `[[code].tsx:GameTable]`.
- Briscola can be chosen only by the caller during `choosing_briscola` while the seat is not bot-controlled (`canChoose`) `[[code].tsx:GameTable]`.
- Pause/resume controls exist only for practice rooms (`room.isPractice`); "Torna a Gioca" in the practice menu is disabled until the server reports `paused` `[[code].tsx:GameTable]`.
- The on-screen menu button calls `pause()`: it opens the menu and, for an unpaused, unfinished practice game, also sends `POST /api/rooms/${code}/pause`. The Android hardware back button only opens the menu dialog and does not pause or leave the table `[[code].tsx:GameTable]` (`pause`, `BackHandler`).
- The final-result "Torna a Gioca" calls `leave()` before navigating in practice; in multiplayer it only navigates to `/play` `[[code].tsx:GameTable]`.
- The round-summary dialog is shown only while a new deal is being presented, `roundSummary` is set, no trick is being collected and `now < dealReadyAt - (animationMs + reviewMs)` `[[code].tsx:GameTable]` (`showSummary`).

## Side Effects
- HTTP requests to the backend via `useLiveGame` (`sessionRequest`) and a Socket.IO connection opened by that hook `[[code].tsx:GameTable]`.
- Haptics (`touchFeedback`): `'success'` plus `playSound('win')` when the viewer's team wins, `'play'` after a successful card play, and default feedback when a briscola suit is pressed `[[code].tsx:GameTable]`.
- A 500 ms `setInterval` drives the countdown and deal timing; a `BackHandler` listener is registered and removed on unmount `[[code].tsx:GameTable]`.
- Session retry (`useSession().retry`) from the `needsLogin` screen and `router.replace` navigation `[[code].tsx:GameTable]`.

## Verification
- Run: `cd mobile && npx jest src/__tests__/practice.test.tsx src/__tests__/navigation.test.tsx`
