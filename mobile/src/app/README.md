# App routes (`src/app`)

## Overview
Expo Router file-based routes for the native app. `_layout.tsx` wraps every
screen in the session provider and a dark theme and declares one native stack.
Menu screens (home, rules, account, play, tutorial) live here; the waiting
room and the live table are dynamic routes in child directories. Only JS/TS
files in this tree are routes, so tests live outside it.

## Interface
- `RootLayout` (default export) `[_layout.tsx:RootLayout]`: calls `initSound()` once, wraps the app in `SessionProvider` and `ThemeProvider value={DarkTheme}`, hides the status bar and declares `Stack` screens `index`, `rules`, `account`, `tutorial`, `play`, `room/[code]` and `game/[code]`.
- `ErrorBoundary` re-exported from `expo-router` `[_layout.tsx:ErrorBoundary]`.
- `HomeScreen` (`/`) `[index.tsx:HomeScreen]`: logo, sound toggle, account button, decorative `HomeCardFan`, a "Gioca" hero button to `/play` and tiles to `/rules` and `/tutorial`.
- `RulesScreen` (`/rules`) `[rules.tsx:RulesScreen]`: five static rule cards in a `Sheet`, paged with arrow buttons or a horizontal swipe; the last card offers `router.replace('/tutorial')`.
- `AccountScreen` (`/account`) `[account.tsx:AccountScreen]`: login form (username/password), signed-in actions (play, logout) and error recovery (retry, remove saved session); links to the website `siteUrl` for registration.
- `PlayScreen` (`/play`) `[play.tsx:PlayScreen]` and `LobbyView` `[play.tsx:LobbyView]`: lobby hub. Loads `GET /api/rooms/available`, emits `join_lobby` and reloads on `lobbyEvents` = `room_created`, `room_updated`, `room_full`, `room_deleted` `[play.tsx:lobbyEvents]`. Actions: `POST /api/rooms/practice` with `{ tier: 'forte' }` and `botStartTimeoutMs`, `POST /api/rooms` with `{}`, `POST /api/rooms/join` with `{ roomCode }`; each navigates to the resulting room with `router.push`. Under "Le tue partite", up to two of the user's rooms (`lobby.games.slice(0, 2)`) appear as "Rientra" cards that open `/game/` when `room.started`, otherwise `/room/`. Open rooms fill the remaining slots up to `visibleRooms` = 4 `[play.tsx:visibleRooms]`.
- `TutorialScreen` (`/tutorial`) `[tutorial.tsx:TutorialScreen]`: offline guided trick with an authored `hand` of two cards and three `playedCards`; phases `ready`, `playing`, `result`, `complete`. A card plays by tap-to-select then a second tap or **Gioca**, or immediately by dragging it onto the table (`useCardDrag`); the result is shown in a native `Modal`.
- Child routes:
  - [Live game route](./game/README.md): `/game/[code]`.
  - [Waiting room route](./room/README.md): `/room/[code]`.

## Invariants
- `rules` and `account` open as `transparentModal` sheets; `game/[code]` disables the back gesture (`gestureEnabled: false`) `[_layout.tsx:sheet]`, `[_layout.tsx:RootLayout]`.
- Login is submitted only while `state.status === 'signedOut'` with a non-empty trimmed username and a password; the password field is cleared before `login` runs `[account.tsx:AccountScreen]` (`submit`).
- The lobby runs one create/join/practice action at a time (`pending`); on failure it reloads the lobby before showing the error `[play.tsx:LobbyView]` (`act`).
- Lobby requests are aborted when the screen loses focus (`useFocusEffect`), and overlapping loads are guarded by `latestOnly` `[play.tsx:LobbyView]`.
- An existing practice game (`lobby.practice`) is offered as "Riprendi" instead of creating a new one; practice creation and "Crea una stanza" are disabled until the lobby has loaded `[play.tsx:LobbyView]`.
- The join-by-code field accepts only six uppercase letters or digits (`/^[A-Z0-9]{6}$/`) `[play.tsx:LobbyView]` (`validCode`).
- The tutorial makes no network requests; a card plays only in phase `ready` `[tutorial.tsx:TutorialScreen]` (`play`).
- Lobby and room actions require a `signedIn` session; otherwise `PlayScreen` shows a sign-in panel `[play.tsx:PlayScreen]`.

## Side Effects
- Audio session setup and stored sound preference read through `initSound()` on mount `[_layout.tsx:RootLayout]`.
- Backend HTTP through `sessionRequest` and Socket.IO through `useSocketRefresh` `[play.tsx:LobbyView]`.
- Session login/logout/retry through `useSession` (secure storage and network) `[account.tsx:AccountScreen]`.
- Opens the external website with `Linking.openURL(siteUrl)` `[account.tsx:AccountScreen]`.
- Haptics (`touchFeedback`) and `playSound('tap')` on the home account button `[index.tsx:HomeScreen]`.
- Sound effects and accessibility announcements (`AccessibilityInfo.announceForAccessibility`), without haptics, in the tutorial `[tutorial.tsx:TutorialScreen]`.

## Verification
- Run: `cd mobile && npx jest src/__tests__`
