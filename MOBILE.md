# Mobile App (iOS + Android)

The phone apps are the existing React frontend wrapped with [Capacitor](https://capacitorjs.com).
One codebase, same UI as the website on a phone. Web and app players share the
same backend and can play in the same rooms.

## How it works

- `frontend/capacitor.config.ts` and the native projects `frontend/ios/` and `frontend/android/`.
- `npm run build:native` builds the frontend in `native` mode (`frontend/.env.native`) and copies it into both apps.
- In `native` mode (`isNativeApp` in `frontend/src/lib/api.ts`):
  - REST and Socket.IO call the backend URL directly (no Vercel proxy).
  - The app cannot use the cross-site cookie, so it stores the login token and sends it
    as `Authorization: Bearer <token>` and as Socket.IO `auth.token`.
  - Every game table locks to landscape (`frontend/src/lib/fullscreen.ts`).
  - The service worker and the `/version.json` update check are off: app updates come from the stores.
- Backend: login and register also return `token`; REST and Socket.IO accept the cookie or the token.
  CORS allows `FRONTEND_URL` plus the app origins `capacitor://localhost` (iOS) and `https://localhost` (Android).

## Build

Requires Node 22+.

```bash
cd frontend
npm run build:native
npx cap open ios       # Xcode
npx cap open android   # Android Studio
```

Android without Android Studio:

```bash
brew install --cask android-commandlinetools
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
cd frontend/android && ./gradlew assembleDebug   # app/build/outputs/apk/debug/app-debug.apk
```

One-time emulator setup (the `becca` virtual phone used below):

```bash
sdkmanager "emulator" "system-images;android-36;google_apis;arm64-v8a"
avdmanager create avd -n becca -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_7
```

## Run on a phone simulator against a local backend

Start the local backend first (Postgres + `cd backend && npm run dev`, see `CLAUDE.md`), then:

```bash
cd frontend
npm run android:local   # Android emulator `becca` (or a USB phone)
npm run ios:local       # iOS simulator; pick one with IOS_SIMULATOR="<name>"
```

`scripts/mobile-local.sh` prints each step:

1. Checks the backend answers on `localhost:8000`.
2. Builds the web app in `native` mode, pointing at the local backend.
3. Builds the native app (Android debug APK, or Xcode simulator build).
4. Starts the emulator/simulator. Android also runs `adb reverse` so the phone's `localhost:8000` reaches this Mac; the iOS simulator shares the Mac's network.
5. Installs and opens the app.

Run it again after each frontend change.

- Only debug builds allow plain `http` (`android/app/src/debug/AndroidManifest.xml`). Release builds are HTTPS-only.
- Inspect the app WebView from `chrome://inspect` (Android) or Safari > Develop (iOS).
- Room presence comes from sockets: players joined only via REST do not appear live in the waiting room.

## Status

| Item | State |
| ---- | ----- |
| Token auth, CORS, native build mode | Done |
| Landscape table, notch-safe layout (header clears the iOS status bar) | Done |
| Android debug build, tested on emulator (login, room, game start) | Done |
| Backend deployed with token auth | To do (the app cannot reach production until then) |
| iOS simulator build and launch | Done (login and game not yet verified on iOS) |
| iOS simulator for a standard iPhone (e.g. iPhone 17) | To do (installed iOS 27.1 runtime only supports iPhone Duo) |
| Hide Android status/navigation bars on the table | To do |
| App icons and splash screen | To do |
| Push notifications ("your turn") | To do |
| Store release (Apple Developer, Google Play) | To do |

Keep the API backward compatible: installed app versions stay in use after each deploy.
