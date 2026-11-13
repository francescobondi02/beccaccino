# BECCA mobile

Native iPhone and Android client. The React/Vite website stays in `../frontend`;
this app does not wrap it in a WebView. Both clients will use the existing backend.

## Requirements

- Node 26 (`nvm use`), npm and the npm lockfile.
- For the initial phone preview: Expo Go with SDK 58 support, and a computer
  and phone on the same Wi-Fi network. The iOS App Store release 58.0.5,
  released October 22, 2026, explicitly adds SDK 58 support.
- For native iOS builds later: macOS, Xcode and CocoaPods. Physical iPhone
  development builds also need Apple signing configured.
- For native Android builds later: Android Studio, an SDK/device, and the JDK
  required by the generated Android Gradle project.

## Expo Go preview

```sh
cd mobile
nvm use
npm ci
npx expo login         # sign in yourself; never share account credentials
npm start
```

On iPhone, sign in to Expo Go with the same **Expo account** used by the CLI,
then scan the terminal's QR code with the Camera app. This is not a BECCA
account. Keep Metro running; Fast Refresh updates the app after source changes.
No USB cable, CocoaPods or custom native build is needed for this preview.

The app currently provides a landscape home, a native rules guide, an offline
guided trick, real username/password login, secure session restoration/logout,
a server-backed **Gioca** hub (practice, live room list, create/join by code), a
native waiting room and the shared live table for practice and multiplayer. Native stack navigation handles
back gestures and platform transitions. Standard buttons are at least 50 points
tall; compact buttons are 40 points, the round sound toggle 44 points and the
round sheet close X 36 points (with a 10-point `hitSlop`). Screens never
scroll: `FitScreen` scales content that is taller than the screen down to fit.
The home card fan and the tutorial use unmodified copies of five real deck images from
`frontend/public/images/cards/`, not the stylized SVG illustrations; the home
**Prova** tile also shows a sixth, `asso_coppe.png`. These
sources are only 63×100 pixels; enlarging them does not add detail, and
Retina-quality rendering will require higher-resolution originals. Only the
forty original cards are bundled. No browser or WebView renders app screens.

The home fan consists of five native images with individual rotations, shadows,
perspective and gentle floating motion. Pressing the artwork tilts the fan,
without triggering navigation. Motion
uses the native driver, does not reserve interaction handles, and stops when the
screen loses focus or the app becomes inactive. The shared reduced-motion
preference keeps both home and table still until the preference is known,
honors live changes and falls back to no motion if the query fails. The fan
is decorative and excluded from screen-reader navigation.

## Guided trick

“Prova una presa” is a playable, explicitly offline learning exercise, not a
multiplayer preview. Three cards are already on the table; the player selects
one of two legal cards and confirms with a second tap or **Gioca**; dragging a
card onto the table plays it immediately. The played card moves into the
fourth position, the winner is identified with text as well as color, and the result
explains the Beccaccino rule. Replay resets the same authored scenario. No
network requests, accounts, rewards, saved progression or new game engine are
involved.

The design follows Apple's game guidance: teach through play, allow direct
selection of objects, keep frequent actions near the thumbs, and respect safe
areas. Confirmation prevents an exploratory tap from immediately playing a card; a drag
onto the table is treated as a deliberate play.
The landscape game is a full-screen native scene, not a split tutorial page.
It preserves the website's purple felt, luminous oval rail, partner opposite,
opponents at the sides and cards in hand at the bottom. A locally generated
felt texture avoids a gradient dependency. Cards arrive from the seats, the
confirmed card travels from its actual hand position, the winning card pulses
and the trick moves toward the winner before the short result modal opens.
All transforms use React Native's native animation driver and stop on unmount.
The table fits the safe-area viewport without scrolling in normal landscape.
Enlarged text widens the seat badges and moves the partner's badge beside the
card; the controls stay docked at the bottom right.
Reduced motion skips travel, pulse and collection; motion stays off until the
system preference is known, listens for changes and logs query failures.
Card names, selected states and result announcements support screen readers;
the modal hides the underlying table from accessibility navigation.

The home artwork has an explicit, viewport-bounded height and measures its
available width. Each card has explicit dimensions within that frame, avoiding
the intrinsic-image sizing problem of the earlier flattened fan. The approved
left hero remains unchanged.

Balatro's official mobile listing describes controls remastered for touch.
Digitalmoka's Dal Negro Briscola provides a commercial reference for recognizable
traditional cards and offline entry. These are product references, not evidence
that BECCA's layout has passed usability testing; no external artwork is copied.
Automated tests cover calculated table bounds, touch sizes, interactions,
animation completion/cancellation and navigation. They do not prove native
pixel geometry, VoiceOver/TalkBack behavior or device ergonomics. Validate those
on real phones.

## Interaction model

Landscape, game-style and never scrolling. The home has one large **Gioca**
button bottom-right (thumb zone), two tiles (Regole, Prova) and profile/sound
controls on top. Rules and account open as sheets over the current screen
(X or tap outside to close). Hand cards can be tapped (select, tap again to
play), dragged onto the table, or long-pressed to preview; only server-legal
cards are sent. Short original sound effects (`assets/sounds`, synthesized)
use `expo-audio`, follow the iPhone silent switch and can be muted from the
home or the in-game menu; the choice is stored on the device.

## Playing

**Gioca** opens `/play`. It loads `GET /api/rooms/available`, joins the
Socket.IO `lobby` and reloads on `lobby_changed`. Up to two of your active
multiplayer rooms, started or still waiting, appear under **Le tue partite**
(Rientra) and open the table or the waiting room; open rooms can be joined by tap or by the
six-character code (`POST /api/rooms/:code/join`). **Crea una stanza** calls `POST /api/rooms`.

The waiting room (`/room/[code]`) joins the room socket and reloads on
`room_changed`. Tap a free seat to choose a team, choose a
bot tier for empty seats, then **Sono pronto**; a reloaded room with `started` opens the table.
**Invita amici** uses the native share sheet. Multiplayer tables cannot pause:
**Esci e torna dopo** keeps your seat, **Abbandona partita** hands it to a bot.

### Practice against bots

From **Gioca**, choose **Gioca contro i bot**. The hub discovers an
existing active practice game before allowing creation, so reopening the app
does not replace a saved game. Creation uses the existing `forte` policy and
allows 90 seconds for the backend's 75-second bot readiness check. A failed
creation is reconciled before a retry; mutations are never automatically resent.

The native table uses the same REST mutations and `game_state` pushes as the
website. The native socket sends its origin-bound token through `auth.token`;
the server validates it using the existing active-account verifier. Reconnect
rejoins the room with acknowledgement and fetches `GET /api/games/:code/state`.
Every state (push, mutation response, refetch) follows the client update rule:
a state for another table or with a lower `version` is ignored.
The state carries `lastTrick`, including its winner and round,
so collection and history work across rounds without a second rules engine.

Select a legal card, optionally choose a leader signal, then confirm with
**Gioca**. All forty cards are available; the hand is a fan whose card overlap
adapts to the available width, without scrolling. Briscola choice, round scores, figures,
timeouts, bot-control recovery, last-trick history and final scores come from
the backend. The approved felt and card-flight components are shared with the
offline exercise. Native-driver entry/lift/collection, system haptics and
sound effects provide touch feedback; reduced motion remains supported.

The on-screen menu button opens the menu and, in practice, immediately requests
a real server pause. The Android back button only opens the menu and does not
pause; use **Metti in pausa** there. Returning to the practice screen
is enabled only after the server confirms it. Backgrounding disconnects the
socket and attempts a pause, but mobile suspension or missing connectivity can
prevent that request: use explicit pause before leaving when it must be guaranteed.
An interrupted app restores from the server rather than assuming it was paused.
Abandoning requires confirmation and uses the existing archive-and-retire path.

The app and backend share the contract types in `backend/src/contract/`, so
both must be deployed from the same commit. Local play
requires the existing Python service and its approved trained model, with the
same private `BOT_SERVICE_TOKEN` in the backend and bot processes.

## Native development builds

Use a development build when adding native modules unavailable in Expo Go, and
to validate the actual app's orientation, splash screen, icon and native behavior.
Expo Go is a preview host, not proof that the standalone app works correctly.

```sh
npm run build:ios       # generates ignored ios/ and installs the app
# or: npm run build:android
npm run start:dev-client
```

Rebuild after adding native dependencies or changing native app configuration.
Do not install native build tools or submit cloud builds merely to use Expo Go.

## Backend configuration

The app uses production (`https://beccaccino-server.onrender.com`) by default,
so it shares accounts and data with the website. Native login and live games
require the native backend support (login, socket token, last trick) to be
deployed there. To use a local backend instead, copy `.env.example` to
`.env.local`, set `EXPO_PUBLIC_BACKEND_URL` to its **origin** (without `/api`)
and restart Metro. Delete `.env.local` to return to production.

On a physical phone, `localhost` means the phone. For Android Emulator, the
host machine is normally `10.0.2.2`; iOS Simulator can reach the Mac's localhost.
Use HTTPS on devices; native transport policies may reject local HTTP. Release
JavaScript rejects non-HTTPS backend URLs. Do not disable transport security to
work around deployment problems.

`EXPO_PUBLIC_*` values are bundled into the app and **are not secrets**. Never
include JWT signing keys, service tokens, database URLs or account passwords.
### Native session

The native account screen calls `POST /api/users/native/login`, which reuses
the existing credential checks and returns `{ user, token }` without setting a
cookie. Authenticated REST calls send `Authorization: Bearer <token>`; an explicit
invalid Authorization header never falls back to a cookie or test identity.
Existing browser login/registration cookies and response bodies are unchanged.
Both transports reuse `verifyActiveSession`, including deleted-account checks.

`expo-secure-store` persists only the token and its backend origin, not passwords
or cached account data. A token saved for another origin is never sent there.
Restoration verifies `/api/users/me` before showing an authenticated account,
including on foreground resume. HTTP 401 removes the invalid saved credential;
network/server failures preserve it and expose retry. Storage failures are
visible: login cannot succeed before secure persistence, and logout failure
does not pretend the user signed out. Pending requests are serialized and
cancelled on provider unmount; network calls time out after eight seconds.

Logout deletes the device credential. It does not introduce server-side token
revocation or refresh tokens; issued JWTs retain the existing seven-day policy.
Socket.IO accepts native `auth.token` as well as existing browser cookies.
Explicit invalid native tokens never fall back to cookies. Registration, profile editing and account deletion are outside
this first integration slice. Expo authentication is not game authentication.

For an optional local phone preview, run a backend yourself and set
`EXPO_PUBLIC_BACKEND_URL` in `.env.local` to its origin; no tracked
configuration defines that backend's port or database. Use a separate
development database, not the website's local DB or the public service.
Only integration tests may reset the guarded `localhost/becca_test` database.
Use test credentials on local HTTP. If that backend's signing key changes (for example a
generated key on restart), saved preview sessions become invalid. Remove `.env.local` before
exporting a release so it targets the HTTPS production origin. Never disable native transport security.

## Architecture and platform rules

- `src/app/`: Expo Router screens and native navigation.
- `src/lib/`: backend access and pure logic; no React imports except the
  `useSoundEnabled` hook in `sound.ts`.
- `src/context/SessionContext.tsx`: native account/session lifecycle.
- `src/constants/theme.ts`: the existing BECCA palette.
- Use React Native primitives and `StyleSheet`, not HTML, CSS, shadcn or WebViews.
  `react-dom` is version-aligned with React for Expo Router's tooling peers;
  app platforms and screens remain native-only.
- Respect safe areas, system navigation, font scaling and screen readers.
  Screens do not scroll; `FitScreen` scales oversized content down instead.
- Touch targets are not yet uniformly 48 points: compact buttons are 40, the
  sound toggle, room-code input and account link 44, and the sheet close X 36
  (10-point `hitSlop`). Touch-target sizes and large-text behaviour are an open
  item deferred to the upcoming mobile design work.
- Orientation is landscape; layouts still adapt to resized windows and platform
  restrictions. iPad-specific UI is outside this initial phone scope.
- Keep server-authoritative game rules and REST/Socket.IO contracts unchanged.
  Share code only when an actual second consumer needs it.
- Test networking, interruptions, background/resume and reconnection on both
  platforms before claiming gameplay support.

## Quality checks

```sh
npm run check          # TypeScript, ESLint and Jest
npm run check:sdk      # live Expo dependency alignment; also required in CI
npm run doctor         # Expo project and native dependency diagnostics
npm run export         # production JavaScript/assets for iOS and Android
```

On October 31, 2026, the user approved temporarily restoring the locally
installable Expo 58.0.16 / React Native 0.88.0 baseline. GitHub had successfully
validated newer patches in commit `7ea2969`, but the corporate registry still
returns 404 for React Native 0.88.1. The old lockfile is restored deliberately;
the one-time auto-update workflow is removed to avoid undoing that decision.
`npm ci` installs this development baseline. `check:sdk` remains required in CI
and may fail against newer recommended patches: do not suppress that release
gate. Retry alignment once the approved registry provides those versions.

Doctor also reports missing CocoaPods on this Mac after generating the iOS
project. CocoaPods is required for local native builds, not Expo Go previews.
The October 31 dependency install reports 50 findings, including 4 high-severity
findings in the Expo toolchain dependency tree. No forced SDK downgrades or
dependency overrides have been applied. Review and resolve these findings before
distribution; a successful JavaScript export is not a security clearance.

Exports do not prove a native binary builds or behaves correctly on a device.
Run native builds and device smoke tests separately. Tests live outside
`src/app/`, so the router never treats them as screens.

Native projects are generated from `app.json` and config plugins and remain
ignored. Do not make permanent manual changes inside `ios/` or `android/`.
EAS profiles cover development clients, simulator builds and internal previews.
There is deliberately no production, submit or auto-update configuration.
The `.dev` bundle/package identifiers and `becca-dev` scheme are development
identities; review distribution identifiers and signing before store releases.
No EAS account/project, cloud build or publication is required by this setup.

## Interface

- [Mobile source](./src/): routes, components, hooks, session context,
  theme and backend library.
- `package.json` scripts: `start`, `start:dev-client`, `android`, `ios`,
  `build:android`, `build:ios`, `typecheck`, `lint`, `test`, `doctor`, `export`,
  `check`, `check:sdk`. The app entry point is `expo-router/entry` (`main`).
- `app.json`: Expo config (name `BECCA Dev`, scheme `becca-dev`, landscape
  orientation, plugins `expo-router`, `expo-secure-store`, `expo-splash-screen`,
  experiments `typedRoutes` and `reactCompiler`).
- `jest.setup.ts`: Jest setup that mocks `expo-audio`
  (`setAudioModeAsync`, `createAudioPlayer`).
- `eslint.config.js`: `eslint-config-expo/flat`, ignoring `dist/**` and
  `coverage/**`.
- `tsconfig.json`: strict TypeScript with the `@/*` alias for `./src/*` and
  `@contract/*` for the shared types in `../backend/src/contract/*` (type-only imports).

## Invariants

- The only runtime configuration is `EXPO_PUBLIC_BACKEND_URL`: an empty value
  means `https://beccaccino-server.onrender.com`; any other value must be a
  bare origin, and release builds require HTTPS (`src/lib/backend.ts`).
- The server owns game rules and state. The app sends mutations over REST.
  The table renders the full `GameState` from `game_state` pushes, the briscola
  and card responses, and refetches. Lobby and waiting-room screens treat
  `lobby_changed` and `room_changed` only as reload signals. Room, lobby and game
  responses use the shared contract types without runtime parsing; account
  responses are parsed with `readUser` in `src/lib/session.ts`.
- Authentication uses a bearer token stored with `expo-secure-store` and bound
  to its backend origin; browser cookies are never used (`credentials: 'omit'`).
- Generated native folders (`/ios`, `/android`), `dist/` and `.env*.local` are
  ignored by `.gitignore`.

## Side Effects

- HTTP requests and Socket.IO connections to the configured backend.
- Secure-storage entries `becca.session` (origin and token) and `becca.sound`
  (sound preference) on the device.
- Audio playback, haptics and screen-reader announcements on the device.
- Opens the website registration page in the system browser from the account
  screen.

## Verification

- Run: `cd mobile && npm run check`

## Official references

- https://docs.expo.dev/versions/v58.0.0/
- https://apps.apple.com/it/app/expo-go/id982107779
- https://docs.expo.dev/get-started/start-developing/
- https://docs.expo.dev/develop/development-builds/introduction/
- https://docs.expo.dev/guides/local-app-development/
- https://docs.expo.dev/develop/unit-testing/
- https://developer.apple.com/design/human-interface-guidelines/accessibility
- https://developer.android.com/guide/topics/ui/accessibility/apps
- https://reactnative.dev/docs/accessibility
- https://reactnative.dev/docs/accessibilityinfo
- https://reactnative.dev/docs/animated
- https://reactnative.dev/docs/animations
- https://reactnative.dev/docs/network
- https://docs.expo.dev/versions/latest/sdk/securestore/
- https://docs.expo.dev/router/advanced/authentication/
- https://docs.expo.dev/router/reference/focus-handling/
- https://developer.apple.com/design/human-interface-guidelines/designing-for-games
- https://developer.apple.com/design/human-interface-guidelines/game-controls
- https://developer.android.com/develop/ui/compose/accessibility/api-defaults
- https://apps.apple.com/us/app/balatro/id6502453075
- https://www.digitalmoka.com/en/briscola-online
