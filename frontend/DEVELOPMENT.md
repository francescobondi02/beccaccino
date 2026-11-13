# Frontend — Development Guide

## Prerequisites

- **Node.js** 24+ (matches CI)
- Backend running at `http://localhost:8000` (`docker compose up -d` from the project root, or `docker compose up -d db adminer` plus `cd backend && npm run dev`)

## Environment Setup

```sh
cp .env.example .env
```

This gives you:
```env
VITE_API_URL=http://localhost:8000/api
VITE_SOCKET_URL=http://localhost:8000
```

> **Important:** Vite only exposes variables prefixed with `VITE_` to the client code.

In development the browser always calls `/api` and `/socket.io/` on the Vite
server, which proxies both to the origin of `VITE_SOCKET_URL` (falling back to
`VITE_API_URL`, then `http://localhost:8000`). Only production builds read
`VITE_API_URL` as the REST base (default `/api`); production sockets always use
the page origin.

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
│   ├── main.tsx                # React entry point; registers /sw.js in production
│   ├── App.tsx                 # Providers, app-update check, routes, .arcade-app layout route
│   ├── pages/
│   │   ├── LobbyPage.tsx       # Home/lobby page (login, room list, create/join, ?join= prefill)
│   │   ├── GameRoom.tsx        # Waiting room (team pick, ready up, bots, invite link)
│   │   ├── GameTable.tsx       # Active game (desktop and mobile live-table layouts)
│   │   ├── Profile.tsx         # User profile and statistics
│   │   ├── Leaderboard.tsx     # Global leaderboard
│   │   ├── Practice.tsx        # Practice game setup
│   │   ├── Annotation.tsx      # Expert access-code gate and annotation workflow
│   │   └── NotFound.tsx        # 404
│   ├── components/
│   │   ├── AnnotationScenario.tsx # Shared context and play-card/briscola decisions
│   │   ├── annotation/         # Annotation summary, trick, action, and dialog views
│   │   ├── game/               # Board, score header, practice controls, RotateDevicePrompt
│   │   ├── lobby/              # Lobby hero, actions, room lists, and card artwork
│   │   ├── rooms/              # Waiting-room player presentation
│   │   ├── AuthDialog.tsx      # Login/register modal
│   │   ├── Header.tsx          # Top nav bar
│   │   ├── PlayingCard.tsx     # Card image renderer
│   │   ├── TrumpSuitDialog.tsx # Briscola selection (dialog or inline on mobile)
│   │   ├── SignalDialog.tsx    # Leader signal choice (dialog or inline on mobile)
│   │   ├── RoundEndDialog.tsx  # Round results
│   │   ├── GameResult.tsx      # Full-page final scores and awards
│   │   ├── LastTrickDialog.tsx # View last trick
│   │   └── ui/                 # shadcn/ui primitives (do not edit manually)
│   ├── sockets/
│   │   ├── events.ts           # Typed client/server event contract
│   │   ├── socketClient.ts     # Singleton socket connection
│   │   ├── lobbyHandlers.ts    # Lobby events (room_created, room_updated, etc.)
│   │   └── roomHandlers.ts     # Room events (player_joined, team_chosen, etc.)
│   ├── hooks/
│   │   ├── useAppUpdate.ts     # Production /version.json polling and reload toast
│   │   ├── useAuth.ts          # Shared authentication state and actions
│   │   ├── useConnectionStatus.ts # Socket status and reconnect refresh
│   │   ├── useGameTable.ts     # Game table loading and socket coordination
│   │   ├── useLobbyRooms.ts    # Lobby fetch and socket reconciliation
│   │   ├── useMobileTable.ts   # Landscape-phone media query for the live table
│   │   ├── useReducedMotion.ts # prefers-reduced-motion media query
│   │   ├── useRoundDeal.ts     # Round deal presentation phases
│   │   ├── useTurnCountdown.ts # Server-authoritative timer presentation
│   │   └── useWaitingRoom.ts   # Waiting-room fetch and socket reconciliation
│   ├── game/                   # Game DTOs, reducer state, and view selectors
│   ├── annotations/            # Expert annotation API model and presentation helpers
│   ├── rooms/                  # Room DTOs, normalization, and pure reducers
│   ├── preview/                # Development-only prototypes (/preview/*)
│   ├── styles/                 # arcade.css, mobile-app.css, mobile-table.css
│   └── lib/
│       ├── api.ts              # Typed REST request helpers
│       ├── fullscreen.ts       # Phone fullscreen and landscape lock
│       ├── roomRedirect.ts     # Active-room conflict navigation
│       └── utils.ts            # cn() utility (clsx + tailwind-merge)
├── public/
│   ├── images/cards/           # Italian card images ({value}_{suit}.png)
│   ├── images/semi/            # Suit icons
│   ├── manifest.webmanifest    # Installable app manifest
│   └── sw.js, offline.html     # Service worker and offline page
├── index.html                  # HTML entry
├── vite.config.ts              # Port 8081, /api and /socket.io proxy, @ alias, app-version plugin
├── vercel.json                 # Rewrites, headers, Function settings
├── tailwind.config.ts          # Tailwind + custom animations
├── tsconfig.json               # TypeScript config
└── package.json
```

## Key Architecture Decisions

- **Single socket connection**: `socketClient.ts` provides a singleton. All pages use it via `lobbyHandlers.ts` and `roomHandlers.ts`.
- **Auth via HTTP-only cookies**: The backend sets a `authToken` cookie. All `fetch()` calls use `credentials: "include"`.
- **State management**: Local React state + React Query. No global store.
- **Real-time updates**: Socket.IO for live events (player joined, card played, round ended). REST for mutations (play card, choose team, ready up).
- **Page ownership**: Pages own route adaptation, user feedback, commands, and view composition. Hooks own asynchronous coordination. Reducers and selectors remain pure.
- **Trick history**: Live games, including practice, expose only the previous completed trick through `LastTrickDialog` ("Ultima presa"). There is no full practice history or revealed-hand view, including in development.
- **Mobile live table**: `useMobileTable()` matches landscape coarse-pointer screens up to 540px high. `GameTable` then renders the `GameBoard` mobile layout (`src/styles/mobile-table.css`) with inline briscola and signal choices and a collapsible tools menu.
- **Identity changes**: `useAuth` drops the singleton socket whenever the signed-in user changes, so the next handshake carries the new cookie identity.
- **Invite links**: `/room/:code` joins non-members through `POST /rooms/join`; signed-out visitors are redirected to `/?join=CODE` with the code prefilled.
- **App updates**: Production builds poll `/version.json` and show a persistent "Aggiornamento disponibile" toast with a reload action when the build id differs (see [Deployment](#deployment)).
- **Practice pause**: The explicit pause action stops server-side bot and timer activity before returning home. Paused games appear under `Allenamenti in pausa`; resume completes before navigation, while direct paused-game links show blocking resume and confirmed-abandon controls. Disconnects never pause a game automatically.
- **Expert annotations**: REST-only workflow. The backend supplies immutable
  scenario identity and legal actions; the client returns the selected action
  or an explicit skip plus perceived difficulty without exposing model
  suggestions. Scenarios are discriminated as card-play or briscola decisions;
  both reuse the same skip, timing, difficulty, retry, and stale-response flow.
  Normal account login owns progress, while a separate shared code grants
  expert access.

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
├── annotations/           # Annotation presentation helpers
├── components/            # Component rendering and interaction
├── game/                  # Game presentation selectors
├── hooks/                 # Auth, connection, game-state reducer and timers
├── pages/                 # Page request and workflow states
├── rooms/                 # Room normalization and reducers
├── *Handlers.test.ts      # Lobby and room socket subscriptions
├── socketClient.test.ts   # Socket singleton behavior
├── useAppUpdate.test.ts   # Version polling and update toast
├── fullscreen.test.ts     # Phone fullscreen helpers
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
│   └── fixtures.ts         # Playwright fixtures with createBot factory
├── annotation.spec.ts      # Account login, expert code, answer, skip, and ratings
├── arcade-ui.spec.ts       # Arcade layout, round recap, results, rules, and table demo
├── first-trick.spec.ts     # Briscola selection and the first 4-card trick
├── game-motion.spec.ts     # Table layout and card travel/collection animations
├── lobby-to-game.spec.ts   # 4 players: register → room → teams → ready → game starts
├── mobile-app.spec.ts      # Real routes in the landscape shell, mobile multiplayer and practice
├── mobile-preview.spec.ts  # /preview/mobile prototype
└── practice-pause-resume.spec.ts # Pause, resume, direct overlay, mobile, abandon
```

The annotation E2E test seeds two valid SQL scenarios through
`backend/tests/helpers/seedAnnotationE2e.ts`; it does not depend on a
pre-populated local database.

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
- **Theme**: `next-themes` forces `html[data-ui="arcade"]`; there is no theme switch. `tailwind.config.ts` still sets `darkMode: ["class"]`.
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
| `/annotate` | Annotation | Shared-code gate and expert scenario labeling |
| `*` | NotFound | 404 |

All routes above share a layout route that renders `.arcade-app` and
`RotateDevicePrompt`. In development only, `/preview/profile`, `/preview/mobile/*`
and `/preview/*` render the design prototypes in `src/preview/`.

## Expert Annotation API

`Annotation.tsx` uses the normal BECCA registration and account login flow.
The shared code grants expert access to that account, and the backend then
serves one unanswered scenario at a time with the account's contribution
count. `AnnotationScenario.tsx` rotates all seat labels around the acting seat,
renders raw scores as points plus figures, and enables only actions present in
`legalActions`. Card-play leaders must explicitly choose `Striscio`, `Busso`,
`Volo`, or `Niente`; followers submit the legal null-signal action directly.
Briscola scenarios show the full hand and four suit choices without trick
history or an already selected briscola.
`Non sono sicuro` accepts an optional 500-character comment before submitting
the skipped response.

The page uses these REST endpoints through `src/lib/api.ts`:

```text
GET  /annotations/status
POST /annotations/access
GET  /annotations/next
POST /annotations/responses
```

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
- Verify the backend is running at the proxy target (`VITE_SOCKET_URL`, else `VITE_API_URL`, else `http://localhost:8000`)
- Vite requires a restart when `.env` files change

**CORS errors:**
- Development requests are same-origin through the Vite proxy. CORS applies only when a build calls a cross-origin `VITE_API_URL`; then the backend `FRONTEND_URL` must match the page origin
- All `fetch()` must include `credentials: "include"`

**Socket not connecting:**
- The client always connects to the page origin at `/socket.io/`; in development check the proxy target above
- Verify backend is running and accessible
- Annotation access does not authenticate the game Socket.IO connection
