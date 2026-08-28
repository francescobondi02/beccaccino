# Frontend — Development Guide

## Prerequisites

- **Node.js** 18+
- Backend running at `http://localhost:8000` (via Finch Compose from project root)

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

## Starting the Frontend

```sh
cd frontend
npm install
npm run dev
```

The dev server runs at **http://localhost:8081**.

## Project Structure

```
frontend/
├── src/
│   ├── main.tsx                # React entry point
│   ├── App.tsx                 # Router + QueryClient and Sonner providers
│   ├── pages/
│   │   ├── LobbyPage.tsx       # Home/lobby page (login, room list, create/join)
│   │   ├── GameRoom.tsx        # Waiting room (team pick, ready up)
│   │   ├── GameTable.tsx       # Active game (card play, trump, rounds)
│   │   ├── Profile.tsx         # User profile and statistics
│   │   ├── Leaderboard.tsx     # Global leaderboard
│   │   ├── Practice.tsx        # Practice game setup
│   │   ├── Annotation.tsx      # Expert access-code gate and annotation workflow
│   │   └── NotFound.tsx        # 404
│   ├── components/
│   │   ├── AnnotationScenario.tsx # Shared context and play-card/briscola decisions
│   │   ├── annotation/         # Annotation summary, trick, action, and dialog views
│   │   ├── game/               # Active-table board, score, and practice controls
│   │   ├── lobby/              # Lobby actions, room lists, and card background
│   │   ├── rooms/              # Waiting-room player presentation
│   │   ├── AuthDialog.tsx      # Login/register modal
│   │   ├── Header.tsx          # Top nav bar
│   │   ├── PlayingCard.tsx     # Card image renderer
│   │   ├── TrumpSuitDialog.tsx # Briscola selection dialog
│   │   ├── PracticeHistoryDialog.tsx # Development-only practice history
│   │   ├── RoundEndDialog.tsx  # Round results
│   │   ├── GameFinishedDialog.tsx  # Game over screen
│   │   ├── LastTrickDialog.tsx # View last trick
│   │   └── ui/                 # shadcn/ui primitives (do not edit manually)
│   ├── sockets/
│   │   ├── socketClient.ts     # Singleton socket connection
│   │   ├── lobbyHandlers.ts    # Lobby events (room_created, room_updated, etc.)
│   │   └── roomHandlers.ts     # Room events (player_joined, team_chosen, etc.)
│   ├── hooks/
│   │   ├── useAuth.ts          # Shared authentication state and actions
│   │   ├── useConnectionStatus.ts # Socket status and reconnect refresh
│   │   └── useGameTable.ts     # Game table loading and socket coordination
│   │   ├── useLobbyRooms.ts    # Lobby fetch and socket reconciliation
│   │   └── useWaitingRoom.ts   # Waiting-room fetch and socket reconciliation
│   ├── game/                   # Game DTOs, reducer state, and view selectors
│   ├── annotations/            # Expert annotation API model types
│   ├── rooms/                  # Room DTOs, normalization, and pure reducers
│   ├── v2/                     # Unrouted V2 design foundation
│   └── lib/
│       ├── api.ts              # Typed REST request helpers
│       └── utils.ts            # cn() utility (clsx + tailwind-merge)
├── public/
│   ├── images/cards/           # Italian card images ({value}_{suit}.png)
│   └── images/semi/            # Suit icons
├── index.html                  # HTML entry
├── vite.config.ts              # Vite config (port 8081, @ alias)
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
- **V2 status**: `src/v2/` is not imported by the active router or stylesheet entry point. Do not duplicate V1 behavior there until migration ownership is decided.
- **Practice history**: When running the Vite dev server (`npm run dev`, where `import.meta.env.DEV` is true), practice games show a history icon that opens the large `PracticeHistoryDialog`. It groups played cards by trick, using card images with player names and declared signals, and clears when a new deck is dealt. Revealed hands are opt-in, hidden by default, and reset when the dialog closes. There is no practice side rail or table layout shift.
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
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

#### Unit Test Structure

```
frontend/src/__tests__/
├── setup.ts                # jest-dom, browser API, and environment setup
├── components/            # Component rendering and interaction
├── hooks/                 # Auth, connection, and game-state behavior
├── pages/                 # Page request and workflow states
├── rooms/                 # Room response normalization
├── *Handlers.test.ts      # Lobby and room socket subscriptions
├── socketClient.test.ts   # Socket singleton behavior
└── utils.test.ts          # Shared utility behavior
```

Use the Vitest summary from `npm test` as the authoritative source for current
test-file and test counts.

#### Coverage

Run `npm run test:coverage` to generate a coverage report. The HTML report is written to `coverage/` and the terminal shows a summary table. CI requires at least 70% statements, branches, and lines, plus 60% functions.

---

### E2E Tests (Playwright)

End-to-end tests use **Playwright** to simulate 4 real browser sessions playing together. Each player gets an isolated browser context (independent cookies/sessions), coordinated via `async/await`.

#### Prerequisites

- Finch DB running (`finch compose up -d db` from project root)
- Backend dependencies and environment configured
- Frontend dependencies installed

Playwright auto-starts the backend and frontend through `playwright.config.ts`.
It does not reuse servers already listening on ports 8000 and 8081 unless
`E2E_REUSE_SERVERS=true` is set explicitly. The auto-started backend uses the
isolated `becca_test` database.

For the release-quality local gate, run `./scripts/pre-push.sh` from the project
root. It uses a unique PostgreSQL schema, dedicated ports, and a deterministic
local bot stub. `./scripts/pre-push.sh --keep-open` leaves that verified stack
at `http://localhost:18081` for manual review until Ctrl-C.

#### Commands

```sh
cd frontend

# Run E2E tests (headless)
npm run test:e2e

# Run E2E tests in headed mode (watch the bots play in real browsers)
npm run test:e2e:headed

# Run E2E tests with Playwright's interactive UI
npm run test:e2e:ui
```

#### E2E Test Structure

```
frontend/e2e/
├── helpers/
│   ├── BotPlayer.ts        # Player abstraction (register, join, play cards, etc.)
│   └── fixtures.ts         # Playwright fixtures with createBot factory
├── annotation.spec.ts      # Account login, expert code, answer, skip, and ratings
├── lobby-to-game.spec.ts   # 4 players: register → room → teams → ready → game starts
├── first-trick.spec.ts     # Briscola selection and the first 4-card trick
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
- **Game state**: `data-briscola`, `data-game-finished` attributes for assertions
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
| `npm test` | Run Vitest (unit tests) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:coverage` | Vitest with coverage |
| `npm run test:e2e` | Run Playwright E2E tests (headless) |
| `npm run test:e2e:headed` | Run Playwright E2E tests (visible browsers) |
| `npm run test:e2e:ui` | Run Playwright with interactive UI |

## Styling Conventions

- **Tailwind CSS** with custom theme (HSL CSS variables for colors)
- **shadcn/ui** components in `src/components/ui/` — regenerate via CLI, don't edit manually
- **Dark mode** via CSS class (configured in `tailwind.config.ts`)
- Custom animations: `fade-in`, `glow`, `scroll-up`, `scroll-down`

## Routes

| Path | Page | Description |
|------|------|-------------|
| `/` | LobbyPage | Lobby — login, room list, create/join |
| `/room/:roomCode` | GameRoom | Waiting room — team pick, ready |
| `/game/:gameRoomCode` | GameTable | Active game |
| `/profile` | Profile | User stats and account settings |
| `/annotate` | Annotation | Shared-code gate and expert scenario labeling |
| `*` | NotFound | 404 |

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

## Card Image Naming Convention

Images are at `/images/cards/{value}_{suit}.png`:
- Values: `asso`, `due`, `tre`, `quattro`, `cinque`, `sei`, `sette`, `fante`, `cavallo`, `re`
- Suits: `bastoni`, `coppe`, `denari`, `spade`

> Note: The DB enum uses `denara` but images use `denari`. The `PlayingCard` component handles this mapping.

## Troubleshooting

**Blank page / API calls failing:**
- Check that `frontend/.env` exists with `VITE_API_URL` set
- Vite requires a restart when `.env` files change

**CORS errors:**
- Ensure the backend `FRONTEND_URL` matches `http://localhost:8081`
- All `fetch()` must include `credentials: "include"`

**Socket not connecting:**
- Check `VITE_SOCKET_URL` in `.env`
- Verify backend is running and accessible
- Annotation access does not authenticate the game Socket.IO connection
