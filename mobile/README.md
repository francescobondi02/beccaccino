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
cp .env.example .env.local
npx expo login         # sign in yourself; never share account credentials
npm start
```

On iPhone, sign in to Expo Go with the same **Expo account** used by the CLI,
then scan the terminal's QR code with the Camera app. This is not a BECCA
account. Keep Metro running; Fast Refresh updates the app after source changes.
No USB cable, CocoaPods or custom native build is needed for this preview.

The app currently provides a landscape home, a native rules guide, an offline
guided trick, real username/password login, secure session restoration/logout,
and a read-only backend readiness check. Rooms and full matches are not wired yet.
Missing configuration is shown as
a setup state, separately from network failures. Native stack navigation handles
back gestures and platform transitions; touch controls have at least 48-point
targets, and large text switches the home to a scrollable single-column layout.
Home and tutorial use unmodified copies of the five real deck images from
`frontend/public/images/cards/`, not the stylized SVG illustrations. These
sources are only 63×100 pixels; enlarging them does not add detail, and
Retina-quality rendering will require higher-resolution originals. Only the
five cards currently used are bundled. No browser or WebView renders app screens.

The home fan consists of five native images with individual rotations, shadows,
perspective and gentle floating motion. Pressing the artwork tilts the fan,
without triggering navigation or blocking the surrounding scroll view. Motion
uses the native driver, does not reserve interaction handles, and stops when the
screen loses focus or the app becomes inactive. The shared reduced-motion
preference keeps both home and table still until the preference is known,
honors live changes and falls back to no motion if the query fails. The fan
is decorative and excluded from screen-reader navigation.

## Guided trick

“Prova una presa” is a playable, explicitly offline learning exercise, not a
multiplayer preview. Three cards are already on the table; the player selects
one of two legal cards and confirms separately. The played card moves into the
fourth position, the winner is identified with text as well as color, and the result
explains the Beccaccino rule. Replay resets the same authored scenario. No
network requests, accounts, rewards, saved progression or new game engine are
involved.

The design follows Apple's game guidance: teach through play, allow direct
selection of objects, keep frequent actions near the thumbs, and respect safe
areas. Confirmation prevents an exploratory tap from immediately playing a card.
The landscape game is a full-screen native scene, not a split tutorial page.
It preserves the website's purple felt, luminous oval rail, partner opposite,
opponents at the sides and cards in hand at the bottom. A locally generated
felt texture avoids a gradient dependency. Cards arrive from the seats, the
confirmed card travels from its actual hand position, the winning card pulses
and the trick moves toward the winner before the short result modal opens.
All transforms use React Native's native animation driver and stop on unmount.
The table fits the safe-area viewport without scrolling in normal landscape.
Portrait and enlarged text can scroll/pan the same table, with controls below it.
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

Set `EXPO_PUBLIC_BACKEND_URL` in `.env.local` to the backend **origin**, without
`/api`, and restart Metro. The check calls the existing `GET /ready` endpoint.
It does not create accounts, rooms or database records.

No backend is selected by default. Choose local or staging deliberately; do not
silently point development builds at production. Existing accounts are available
only when both clients use the same backend/database environment.

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
Socket.IO still authenticates through cookies and is not connected by the native
client yet. Registration, profile editing and account deletion are also outside
this first integration slice. Expo authentication is not game authentication.

For the approved local phone preview, the real backend runs separately on port
8001 against `becca_mobile_dev`, not the website's local DB or public service.
Only integration tests may reset the guarded `localhost/becca_test` database.
Use test credentials on local HTTP. The preview signing key is ephemeral, so a
backend restart invalidates saved preview sessions. Configure an explicit HTTPS
staging origin before distribution; exporting JavaScript with `.env.local` is
not a validated release configuration. Never disable native transport security.

## Architecture and platform rules

- `src/app/`: Expo Router screens and native navigation.
- `src/lib/`: backend access and pure logic; no React imports.
- `src/context/SessionContext.tsx`: native account/session lifecycle.
- `src/constants/theme.ts`: the existing BECCA palette.
- Use React Native primitives and `StyleSheet`, not HTML, CSS, shadcn or WebViews.
  `react-dom` is version-aligned with React for Expo Router's tooling peers;
  app platforms and screens remain native-only.
- Respect safe areas, system navigation, font scaling, screen readers and minimum
  48-point touch targets. Keep content scrollable at large font sizes.
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

As of October 28, 2026, the live SDK version service recommends patch versions
that are unavailable in the configured npm registry, including `expo ~58.0.20`
versus the available `58.0.16`. The installed SDK's bundled version map agrees
with the installed dependencies, but this does not replace online validation.
`check:sdk` and the corresponding Doctor check remain failing; CI deliberately
keeps this gate blocking. Do not force unavailable versions or suppress the check.
Resolve this registry/version-service mismatch before declaring the setup fully
validated or distributing builds.

Doctor also reports missing CocoaPods on this Mac after generating the iOS
project. CocoaPods is required for local native builds, not Expo Go previews.
The October 28 dependency audit reports 23 findings, including 5 high-severity
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
