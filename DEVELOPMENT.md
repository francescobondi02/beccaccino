# Frontend — Development Guide

## Prerequisites

- **Node.js** 18+
- Backend running at `http://localhost:8000` (via Docker Compose from project root)

## Environment Setup

Create `frontend/.env`:

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
│   ├── App.tsx                 # Router + providers (QueryClient, Tooltip, Toaster)
│   ├── pages/
│   │   ├── Index.tsx           # Home/lobby page (login, room list, create/join)
│   │   ├── GameRoom.tsx        # Waiting room (team pick, ready up)
│   │   ├── GameTable.tsx       # Active game (card play, trump, rounds)
│   │   ├── Profile.tsx         # User profile (mock data)
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
│   │   ├── use-mobile.tsx      # Responsive breakpoint hook
│   │   └── use-toast.ts        # Toast notification system
│   └── lib/
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

Tests use **Vitest** + **React Testing Library** + **jsdom**.

### Commands

```sh
cd frontend

# Run all tests
npm test

# Run tests in watch mode (development)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

### Test Structure

```
frontend/
├── src/
│   ├── __tests__/
│   │   ├── utils.test.ts           # cn() utility
│   │   ├── socketClient.test.ts    # Socket singleton
│   │   ├── lobbyHandlers.test.ts   # Lobby event handling
│   │   └── components/
│   │       ├── PlayingCard.test.tsx
│   │       └── AuthDialog.test.tsx
```

## Scripts Reference

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server (port 8081) |
| `npm run build` | Production build |
| `npm run build:dev` | Development build |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |
| `npm test` | Run Vitest |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:coverage` | Vitest with coverage |

## Styling Conventions

- **Tailwind CSS** with custom theme (HSL CSS variables for colors)
- **shadcn/ui** components in `src/components/ui/` — regenerate via CLI, don't edit manually
- **Dark mode** via CSS class (configured in `tailwind.config.ts`)
- Custom animations: `fade-in`, `glow`, `scroll-up`, `scroll-down`

## Routes

| Path | Page | Description |
|------|------|-------------|
| `/` | Index | Lobby — login, room list, create/join |
| `/room/:roomCode` | GameRoom | Waiting room — team pick, ready |
| `/game/:gameRoomCode` | GameTable | Active game |
| `/profile` | Profile | User stats (mock) |
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
