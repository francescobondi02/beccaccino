# Mobile

The native iPhone and Android app: Expo SDK 58, React Native and Expo Router,
in landscape. It is a separate app, not a WebView of the website, and it uses
the same REST and Socket.IO API. It runs in Expo Go; installed builds come later.

## Run

1. Run `make dev` at the repository root. Metro runs in the `mobile` container
   (Node 26) on port 8082.
2. Install Expo Go (with SDK 58 support) on the phone. Put the phone on the same
   Wi-Fi as the computer.
3. Scan the QR code that `make dev` or `make qr` prints.
4. Log in with a seed user, for example `alice` with password `password`.

`make dev` sets `EXPO_PUBLIC_BACKEND_URL` to `http://<LAN IP>:8000`, so the
phone talks to the local backend. It must be the LAN IP, not `localhost`: on
the phone, `localhost` is the phone.

`EXPO_PUBLIC_BACKEND_URL` is the only setting. It is a bare origin without
`/api`. Empty means production (`https://beccaccino-server.onrender.com`).
Release builds require HTTPS. `EXPO_PUBLIC_*` values ship inside the app, so
never put secrets in them.

## What the app does

- Home with **Gioca**, the rules and an offline exercise, "Prova una presa".
- Login and registration through `POST /api/users/native/login` and
  `/native/register`. The token is stored in `expo-secure-store`, tied to its
  backend origin, and sent as `Authorization: Bearer` and Socket.IO
  `auth.token`. Cookies are never used.
- **Gioca** lists open rooms and your games, creates a room or joins one by code.
  **Gioca contro i bot** starts a practice game with the `forte` tier.
- The waiting room: tap a free seat to pick a team, set the bot tier, **Sono pronto**,
  **Invita amici**.
- The live table for practice and multiplayer. It renders the full
  `GameState` from `game_state` pushes, mutation responses and refetches, and
  ignores a state with a lower `version`.
- Practice: the menu pauses the game on the server (**Metti in pausa**).
  Multiplayer: **Esci e torna dopo** keeps the seat, **Abbandona partita**
  gives it to a bot.

## Rules for changes

- Use React Native primitives and `StyleSheet`. No HTML, CSS, shadcn or WebViews.
- Wire types come from `backend/src/contract/` through `@contract/*`. Deploy
  the app and backend from the same commit.
- The server owns the rules. Do not copy them into the app.
- Screens never scroll; `FitScreen` scales content down. Respect safe areas,
  font scaling, screen readers and reduced motion.
- `ios/` and `android/` are generated from `app.json` and ignored. Do not edit them.
- Expo Go is a preview host. Test on real phones before claiming device
  behavior such as gestures, VoiceOver or TalkBack.

## Check

```sh
docker compose exec mobile npm run check       # TypeScript, ESLint, Jest
docker compose exec mobile npm run check:sdk   # Expo dependency alignment (advisory in CI)
docker compose exec mobile npm run export      # production JS bundle (CI)
```

The lockfile pins Expo 58.0.16 and React Native 0.88.0 on purpose: in October
2026 the corporate npm registry did not serve the newer patches. `check:sdk`
reports them and fails; CI runs it with `continue-on-error`. Update the patches
once the registry serves them.

Native development builds (`npm run build:ios`, `build:android`,
`start:dev-client`) need Xcode or Android Studio on the host and are not part
of the Docker setup.
