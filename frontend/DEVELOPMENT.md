# Frontend — Development Guide

## Prerequisites

- **Node.js** 24+ (matches CI)
- Backend running at `http://localhost:8000` (`docker compose up -d` from the project root, or `docker compose up -d db adminer` plus `cd backend && npm run dev`)

## Backend Origin

See [README.md](./README.md#environment-variables) for the same-origin `/api` proxy and `BACKEND_URL`.

## Starting the Frontend

```sh
cd frontend
npm ci
npm run dev
```

The dev server runs at **http://localhost:8081**.

## Project Structure

```
frontend/
├── api/socket-proxy.ts         # Vercel Function: WebSocket bridge to Render
├── server/socketProxy.ts       # createSocketProxy() used by the function
├── src/
│   ├── main.tsx                # React entry point
│   ├── App.tsx                 # Providers, app-update check, routes
│   ├── pages/
│   │   ├── LobbyPage.tsx       # Home/lobby page (login, room list, create/join, ?join= prefill)
│   │   ├── GameRoom.tsx        # Waiting room (team pick, ready up, bots, invite link)
│   │   ├── GameTable.tsx       # Active game
│   │   ├── Profile.tsx         # User profile and statistics
│   │   ├── Leaderboard.tsx     # Global leaderboard
│   │   ├── Practice.tsx        # Practice game setup
│   │   └── NotFound.tsx        # 404
│   ├── components/
│   │   ├── game/               # Board, score header, practice controls
│   │   ├── lobby/              # Lobby hero, actions, room lists, and card artwork
│   │   ├── rooms/              # Waiting-room player presentation
│   │   ├── AuthDialog.tsx      # Login/register modal
│   │   ├── Header.tsx          # Top nav bar
│   │   ├── PlayingCard.tsx     # Card image renderer
│   │   ├── TrumpSuitDialog.tsx # Briscola selection dialog
│   │   ├── SignalDialog.tsx    # Leader signal choice dialog
│   │   ├── RoundEndDialog.tsx  # Round results
│   │   ├── GameResult.tsx      # Full-page final scores and awards
│   │   ├── LastTrickDialog.tsx # View last trick
│   │   └── ui/                 # shadcn/ui primitives (do not edit manually)
│   ├── sockets/
│   │   ├── socketClient.ts     # Singleton socket connection
│   │   ├── lobbyHandlers.ts    # lobby_changed subscription
│   │   └── roomHandlers.ts     # Room join/leave and game_state, room_changed, chat events
│   ├── hooks/
│   │   ├── useAppUpdate.ts     # Production /version.json polling and reload toast
│   │   ├── useAuth.ts          # Shared authentication state and actions
│   │   ├── useConnectionStatus.ts # Socket status and reconnect refresh
│   │   ├── useGameTable.ts     # Game table loading and socket coordination
│   │   ├── useLobbyRooms.ts    # Lobby fetch and socket reconciliation
│   │   ├── useReducedMotion.ts # prefers-reduced-motion media query
│   │   ├── useRoundDeal.ts     # Round deal presentation phases
│   │   ├── useTurnCountdown.ts # Server-authoritative timer presentation
│   │   └── useWaitingRoom.ts   # Waiting-room fetch and socket reconciliation
│   ├── game/                   # keepNewer update rule and view selectors
│   ├── rooms/                  # Lobby and waiting-room view selectors
│   ├── styles/                 # arcade.css
│   └── lib/
│       ├── api.ts              # Typed REST request helpers
│       ├── roomRedirect.ts     # Active-room conflict navigation
│       └── utils.ts            # cn() utility (clsx + tailwind-merge)
├── public/
│   ├── images/cards/           # Italian card images ({value}_{suit}.png)
│   ├── images/semi/            # Suit icons
│   └── icons/icon.svg          # Favicon (SVG)
├── index.html                  # HTML entry
├── vite.config.ts              # Port 8081, /api and /socket.io proxy, @ alias, app-version plugin
├── vercel.json                 # Rewrites, headers, Function settings
├── tailwind.config.ts          # Tailwind + custom animations
├── tsconfig.json               # TypeScript config
└── package.json
```

## Key Architecture Decisions

- **Single socket connection**: `socketClient.ts` provides a singleton. All pages use it via `lobbyHandlers.ts` and `roomHandlers.ts`.
- **Auth via HTTP-only cookies**: The backend sets a `authToken` cookie. Same-origin requests send it by default.
- **State management**: Local React state + React Query. No global store. Wire types come from `backend/src/contract` through the `@contract/*` path. The table keeps the server's full `GameState` in React Query `["game", code]`; pushes, mutation responses and refetches all apply it through `keepNewer` (higher `version` wins).
- **Real-time updates**: Socket.IO for live events (player joined, card played, round ended). REST for mutations (play card, choose team, ready up).
- **Page ownership**: Pages own route adaptation, user feedback, commands, and view composition. Hooks own asynchronous coordination. Selectors remain pure.
- **Trick history**: Live games, including practice, expose only the previous completed trick through `LastTrickDialog` ("Ultima presa"). There is no full practice history or revealed-hand view, including in development.
- **Identity changes**: `useAuth` drops the singleton socket whenever the signed-in user changes, so the next handshake carries the new cookie identity.
- **Invite links**: `/room/:code` joins non-members through `POST /rooms/:code/join`; signed-out visitors are redirected to `/?join=CODE` with the code prefilled.
- **App updates**: Production builds poll `/version.json` and show a persistent "Aggiornamento disponibile" toast with a reload action when the build id differs (see [Deployment](#deployment)).
- **Practice pause**: The explicit pause action stops server-side bot and timer activity before returning home. Paused games appear under `Allenamenti in pausa`; resume completes before navigation, while direct paused-game links show blocking resume and confirmed-abandon controls. Disconnects never pause a game automatically.

## Testing

### Unit Tests (Vitest)

Tests use **Vitest** + **React Testing Library** + **jsdom**.

```sh
cd frontend

# Run all unit tests
npm test

# Run tests in watch mode (development)
npx vitest

# Run tests with coverage report
npx vitest run --coverage
```

#### Unit Test Structure

```
frontend/src/__tests__/
├── setup.ts                # jest-dom, browser API, and environment setup
├── components/            # Component rendering and interaction
├── game/                  # Game presentation selectors
├── hooks/                 # Auth, connection, game state and timers
├── pages/                 # Page request and workflow states
├── rooms/                 # Lobby and waiting-room selectors
├── *Handlers.test.ts      # Lobby and room socket subscriptions
├── socketClient.test.ts   # Socket singleton behavior
├── useAppUpdate.test.ts   # Version polling and update toast
└── utils.test.ts          # Shared utility behavior
```

Use the Vitest summary from `npm test` as the authoritative source for current
test-file and test counts.

#### Coverage

Run `npx vitest run --coverage` to generate a coverage report. The HTML report is written to `coverage/` and the terminal shows a summary table. `vitest.config.ts` sets thresholds of 70% statements, branches, and lines, plus 60% functions; they apply only to coverage runs. CI runs `npm test` without coverage, so it does not enforce them.

---

### E2E Tests (Playwright)

End-to-end tests use **Playwright** to simulate 4 real browser sessions playing together. Each player gets an isolated browser context (independent cookies/sessions), coordinated via `async/await`.

#### Prerequisites

- PostgreSQL running (`docker compose up -d db` from the project root)
- Backend dependencies and environment configured
- Frontend dependencies installed

Playwright auto-starts the backend and frontend through `playwright.config.ts`.
It does not reuse servers already listening on ports 8000 and 8081 unless
`E2E_REUSE_SERVERS=true` is set explicitly. The auto-started backend uses the
isolated `becca_test` database.

Set `E2E_EXTERNAL_SERVERS=true` to skip `webServer` entirely and test servers you
started yourself (with `E2E_BASE_URL` for a non-default frontend URL).

#### Commands

```sh
cd frontend

# Run E2E tests (headless; there is no npm script)
npx playwright test

# Run E2E tests in headed mode (watch the bots play in real browsers)
npx playwright test --headed

# Run E2E tests with Playwright's interactive UI
npx playwright test --ui
```

#### E2E Test Structure

```
frontend/e2e/
├── helpers/
│   ├── BotPlayer.ts        # Player abstraction (register, join, play cards, etc.)
│   ├── fixtures.ts         # Playwright fixtures with createBot factory
│   └── gameState.ts        # GameState fixtures for mocked tables
├── arcade-ui.spec.ts       # Arcade layout, round recap, results, and rules
├── first-trick.spec.ts     # Briscola selection and the first 4-card trick
├── full-game.spec.ts       # 4 players finish a game (backend with GAME_WIN_POINTS=5; CI on main only)
├── game-motion.spec.ts     # Table layout and card travel/collection animations
├── lobby-to-game.spec.ts   # 4 players: register → room → teams → ready → game starts
└── practice-pause-resume.spec.ts # Pause, resume, direct overlay, abandon
```

#### How It Works

The `BotPlayer` class encapsulates one player's browser session:

```typescript
const alice = await createBot("Alice");
await alice.register();
const roomCode = await alice.createRoom();

// Other players join
await bob.joinRoomByCode(roomCode);

// Game flow
await alice.chooseTeam(0);
await alice.setReady();
await alice.waitForGameStart();
if (await alice.isMyTurn()) {
  await alice.playFirstAvailableCard();
}
```

Key patterns:
- **Turn detection**: a player has at least one card with `data-playable="true"`
- **Card playability**: only the active player's legal cards expose that attribute
- **Game state**: `data-briscola` and `data-current-turn-userid` on `game-table-page`; `data-game-finished="true"` on the `GameResult` page
- **Cross-player sync**: Each bot polls its own view; WebSocket events update the DOM

#### Configuration

`playwright.config.ts` configures:
- **webServer**: Auto-starts backend (port 8000) and frontend (port 8081)
- **reuseExistingServer**: Disabled unless `E2E_REUSE_SERVERS=true`
- **trace/video**: Recorded on first retry for debugging failures
- **timeout**: 60s by default; the first-trick scenario raises its budget to 90s

#### Debugging Failed E2E Tests

```sh
# Show the HTML report with traces and screenshots
npx playwright show-report

# Run a specific test in headed mode with slowMo
npx playwright test first-trick --headed --timeout=120000
```

## Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server (port 8081) |
| `npm run typecheck` | Run TypeScript project checks |
| `npm run build` | Production build |
| `npm run build:dev` | Development build |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |
| `npm test` | Run Vitest once (unit tests) |

Without an npm script: `npx vitest` (watch mode), `npx vitest run --coverage`,
`npx playwright test` (add `--headed` or `--ui`), `npx playwright show-report`.

## Styling Conventions

- **Tailwind CSS** with custom theme (HSL CSS variables for colors)
- **shadcn/ui** components in `src/components/ui/` — regenerate via CLI, don't edit manually
- **Theme**: `index.html` sets `html[data-ui="arcade"]`; there is no theme switch.
- Custom animations: `fade-in`, `glow`, `scroll-up`, `scroll-down`

## Routes

| Path | Page | Description |
|------|------|-------------|
| `/` | LobbyPage | Lobby — login, room list, create/join |
| `/room/:roomCode` | GameRoom | Waiting room — team pick, ready |
| `/game/:gameRoomCode` | GameTable | Active game |
| `/profile` | Profile | User stats and account settings |
| `/leaderboard` | Leaderboard | Global player rankings |
| `/practice` | Practice | Practice tier selection |
| `*` | NotFound | 404 |

## Deployment

- CI: `.github/workflows/frontend.yml` (path-filtered). Production deploys are not automated yet.
- Every Vite build generates a random UUID, bakes it into the bundle as
  `import.meta.env.VITE_APP_VERSION`, and emits `dist/version.json` with
  `{ "version": "<uuid>" }`. The id is not a commit SHA, so any rebuild counts
  as a new version. `vercel.json` serves `/version.json` with
  `Cache-Control: no-store` and excludes it from the SPA rewrite.

## Card Image Naming Convention

Images are at `/images/cards/{value}_{suit}.png`:
- Values: `asso`, `due`, `tre`, `quattro`, `cinque`, `sei`, `sette`, `fante`, `cavallo`, `re`
- Suits: `bastoni`, `coppe`, `denari`, `spade`

> Note: The DB enum uses `denara` but images use `denari`. The `PlayingCard` component handles this mapping.

## Troubleshooting

**Blank page / API calls failing:**
- Verify the backend is running at the proxy target (`BACKEND_URL`, default `http://localhost:8000`)

**Socket not connecting:**
- The client always connects to the page origin at `/socket.io/`; in development check the proxy target above
- Verify backend is running and accessible
