# Mobile source (`src`)

## Overview
TypeScript source of the native Expo app, imported through the `@/*` path
alias (`tsconfig.json`). Routes in `app` compose UI from `components`, state
and socket logic from `hooks` and `context`, and backend access and parsing
from `lib`. Tests live in `__tests__` directories outside `app`, so Expo
Router never treats them as routes.

## Subdirectories & Boundaries
- app: [./app/README.md](./app/README.md) - Expo Router screens: home, rules, account, play lobby, tutorial, waiting room and live game.
- components: [./components/README.md](./components/README.md) - Presentational React Native components, including the shared `LiveTable` and HUD.
- constants: [./constants/README.md](./constants/README.md) - Theme tokens (`colors`, `fonts`, `hard`, `shared`).
- context: [./context/README.md](./context/README.md) - `SessionProvider` and `useSession` for the account session lifecycle.
- hooks: [./hooks/README.md](./hooks/README.md) - Live game sync, socket refresh, card drag, announcements, reduced motion and navigation hooks.
- lib: [./lib/README.md](./lib/README.md) - Backend origin, secure session, authenticated REST, socket factory, server-response parsers, layout, sound and haptics.
