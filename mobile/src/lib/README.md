# Library (`src/lib`)

## Overview
Backend access, wire-format parsing and small platform helpers for the native
app. Server responses are validated into typed objects here, so screens never
read raw JSON. Game rules stay on the server; this layer only parses and
lays out state.

## Interface
- `backend.ts`: `productionBackend` (`https://beccaccino-server.onrender.com`) and `backendOrigin(backendUrl)` `[backend.ts:backendOrigin]`.
- `session.ts` `[session.ts:signIn]`:
  - `signIn(backendUrl, username, password, signal)`: `POST /api/users/native/login` with the trimmed username, saves `{ origin, token }` in secure storage; a 401 becomes "Nome utente o password non corretti.".
  - `restoreSession(backendUrl, signal)`: `GET /api/users/me` with the saved token `[session.ts:restoreSession]`.
  - `readSessionCredentials(backendUrl)` `[session.ts:readSessionCredentials]`, `clearSession()` `[session.ts:clearSession]`.
  - `sessionRequest(path, signal, body?, timeoutMs?)`: authenticated GET (no body) or POST (JSON body) `[session.ts:sessionRequest]`.
  - `SessionHttpError` (`status`) `[session.ts:SessionHttpError]`: fixed Italian messages for 401, 403, 404, 409, 429 and 5xx; other statuses read `Richiesta non riuscita (HTTP ${status}).`. Type `SessionUser` `[session.ts:SessionUser]`.
- `socket.ts`: `openSocket()` returns an unconnected Socket.IO client authenticated with `auth.token`, with transports `websocket`/`polling` (`tryAllTransports`), `timeout: 8_000` and a reconnection delay of 1000–5000 ms `[socket.ts:openSocket]`; `authFailures` lists the server's auth error messages `[socket.ts:authFailures]`.
- `game.ts`:
  - Constants and types: `suits`, `values`, `signals`, `signalIcons`, `botTiers`, `botStartTimeoutMs` (90 000 ms), `Suit`, `Card`, `Signal`, `PlayedCard`, `Trick`, `Room`, `GameState`, `BotTier`, `WaitingPlayer`, `WaitingRoom`, `Lobby` `[game.ts:GameState]`.
  - Parsers: `record`, `readCard`, `readPlayable`, `readRoomCode`, `readRoom`, `readWaitingRoom`, `readLobby`, `readGameState` `[game.ts:readGameState]`.
  - Helpers: `cardKey`, `cardLabel`, `relativeSeat`, `teamOf`, `ourSide` `[game.ts:relativeSeat]`.
- `cardImages.ts`: `cardImage(card)` returns the bundled image for any of the 40 cards `[cardImages.ts:cardImage]`.
- `tableLayout.ts`: `tableLayout(width, height, largeText = false)` returns card sizes, hand positions, seat positions and table card positions `[tableLayout.ts:tableLayout]`.
- `sound.ts`: `initSound()`, `playSound(name)`, `setSoundEnabled(on)`, `useSoundEnabled()`, type `Sound` (`tap`, `card`, `trick`, `turn`, `win`) `[sound.ts:playSound]`.
- `haptics.ts`: `touchFeedback(kind = 'selection')` with kinds `selection`, `play`, `success` `[haptics.ts:touchFeedback]`.
- `latest.ts`: `latestOnly()` guard for overlapping loads `[latest.ts:latestOnly]`.

## Invariants
- The backend URL must be a bare `http`/`https` origin (no credentials, path, query or hash); release builds (`!__DEV__`) require HTTPS. An empty value means `productionBackend` `[backend.ts:backendOrigin]`.
- Requests go only to the session origin (`url.origin !== origin` throws), use `credentials: 'omit'` and `cache: 'no-store'`, and time out after 8 seconds by default `[session.ts:request]`.
- A saved token is used only when its stored origin matches the current backend origin; otherwise `readSessionCredentials` returns `null` `[session.ts:readSessionCredentials]`.
- `readSessionCredentials` returns `null` only when nothing is saved or the origin differs; it throws an Italian error when secure storage is unreadable, the saved JSON is corrupt or the token is invalid. A token must match `/^\S+$/` `[session.ts:readSessionCredentials]`, `[session.ts:validToken]`.
- `signIn` succeeds only after the token is saved with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; the password is never stored `[session.ts:signIn]`.
- `restoreSession` deletes the saved session only on HTTP 401 `[session.ts:restoreSession]`.
- `sessionRequest` and `openSocket` throw `SessionHttpError(401)` when no credentials are saved `[session.ts:sessionRequest]`, `[socket.ts:openSocket]`.
- Parsers throw on unexpected shapes: integers must be non-negative, enums must match known values, a `Room` must have exactly four players with unique seats 0–3 and teams 0–1, a waiting room at most four players, and a completed trick exactly four cards `[game.ts:readRoom]`, `[game.ts:readWaitingRoom]`, `[game.ts:readGameState]`. Some fields default instead of failing: `round.cricca`, `player.isReady` and `data.started` are `true` only when exactly `true`; a missing waiting-room `player.team` or `data.botTier` becomes `null` `[game.ts:readGameState]`, `[game.ts:readWaitingRoom]`.
- Room codes must match `/^[A-Za-z0-9]{6,12}$/` `[game.ts:readRoomCode]`.
- The ` (bot)` suffix is removed from usernames `[game.ts:displayName]`.
- `relativeSeat` maps seats to 0 left, 1 partner, 2 right, 3 viewer; `ourSide` always returns `[ours, theirs]` `[game.ts:relativeSeat]`, `[game.ts:ourSide]`.
- Sounds and haptics run only while `AppState.currentState === 'active'`; sound also requires the enabled preference `[sound.ts:playSound]`, `[haptics.ts:touchFeedback]`.

## Side Effects
- HTTP via `fetch` to the backend origin `[session.ts:request]`.
- Secure storage (`expo-secure-store`): key `becca.session` for `{ origin, token }` `[session.ts:signIn]`, `[session.ts:clearSession]`; key `becca.sound` for the sound preference `[sound.ts:initSound]`, `[sound.ts:setSoundEnabled]`.
- Socket.IO client creation (connection is started by the caller) `[socket.ts:openSocket]`.
- Audio session mode (`playsInSilentMode: false`, `mixWithOthers`) and audio players created on demand `[sound.ts:initSound]`, `[sound.ts:playSound]`.
- Device haptics `[haptics.ts:touchFeedback]`.
- Console warnings when sound or haptics are unavailable `[sound.ts:warn]`, `[haptics.ts:touchFeedback]`.

## Verification
- Run: `cd mobile && npx jest src/lib`
