# Frontend — Development Guide

## Prerequisites

- **Node.js** 18+
- Backend running at `http://localhost:8000` (via Docker Compose from project root)

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
│   │   └── NotFound.tsx        # 404
│   ├── components/
│   │   ├── AuthDialog.tsx      # Login/register modal
│   │   ├── Header.tsx          # Top nav bar
│   │   ├── PlayingCard.tsx     # Card image renderer
│   │   ├── TrumpSuitDialog.tsx # Briscola selection dialog
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
│   ├── game/                   # Game DTOs and reducer state
│   ├── rooms/                  # Room DTOs and response normalization
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

The current suite contains 137 tests across 22 files. Use the Vitest summary
from `npm test` as the authoritative count as the suite evolves.

#### Coverage

Run `npm run test:coverage` to generate a coverage report. The HTML report is written to `coverage/` and the terminal shows a summary table. CI requires at least 70% statements, branches, and lines, plus 60% functions.

---

### E2E Tests (Playwright)

End-to-end tests use **Playwright** to simulate 4 real browser sessions playing together. Each player gets an isolated browser context (independent cookies/sessions), coordinated via `async/await`.

#### Prerequisites

- Docker DB running (`docker compose up -d db` from project root)
- Backend dependencies and environment configured
- Frontend dependencies installed

Playwright auto-starts the backend and frontend through `playwright.config.ts`, or
reuses servers already listening on ports 8000 and 8081.

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
├── lobby-to-game.spec.ts   # 4 players: register → room → teams → ready → game starts
└── first-trick.spec.ts     # Briscola selection and the first 4-card trick
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
- **Game state**: `data-briscola`, `data-game-finished` attributes for assertions
- **Cross-player sync**: Each bot polls its own view; WebSocket events update the DOM

#### Configuration

`playwright.config.ts` configures:
- **webServer**: Auto-starts backend (port 8000) and frontend (port 8081)
- **reuseExistingServer**: Skips auto-start if servers are already running
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
| `*` | NotFound | 404 |

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
- Browser must have the auth cookie set (login first)
