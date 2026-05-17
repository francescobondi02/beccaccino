# Frontend — React + Vite + shadcn/ui

React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui components. Single-page application.

## Structure

```
src/
  main.tsx              Entry: renders App
  App.tsx               BrowserRouter with routes
  pages/
    Index.tsx           Home/lobby: auth dialog, create/join room, animated card background
    GameRoom.tsx        Room lobby: team selection, ready up, waiting for 4 players
    GameTable.tsx       Main game: card hands, trick area, timers, all dialogs (~1000 lines)
    Profile.tsx         User profile and stats
    Leaderboard.tsx     Global leaderboard
    NotFound.tsx        404 page
  components/
    AuthDialog.tsx      Login/register modal
    Header.tsx          Nav bar with auth state
    PlayingCard.tsx     Single card renderer (suit + value → image)
    TrumpSuitDialog.tsx Briscola selection (4 suit buttons + hand preview)
    SignalDialog.tsx     Signal declaration (striscio/busso/volo/niente)
    GameChat.tsx        In-game chat panel (Socket.IO)
    LastTrickDialog.tsx View last completed trick
    RoundEndDialog.tsx  Round score summary
    GameFinishedDialog.tsx  Game over with final scores
    ui/                 shadcn/ui components (don't edit manually — use CLI to add new ones)
  sockets/
    socketClient.ts     Singleton Socket.IO client, reconnection logic, status tracking
    lobbyHandlers.ts    Lobby socket events: room_created, room_updated, room_full, room_deleted
    roomHandlers.ts     Room socket events: join, leave, team, ready, game start
  hooks/
    use-mobile.tsx      Responsive breakpoint hook
    use-toast.ts        Toast hook
  lib/
    utils.ts            cn() utility for Tailwind class merging
  assets/               Static images used in components
  __tests__/            Vitest unit tests for components and socket handlers
e2e/
  helpers/
    BotPlayer.ts        Playwright helper: headless player that can register, join, play
    fixtures.ts         Multi-browser test fixtures (4 independent contexts)
  lobby-to-game.spec.ts  4 players: register → room → teams → ready → game starts
  full-game.spec.ts      Complete game with briscola selection and card play
public/
  images/cards/         40 card PNGs (format: {value}_{suit}.png, e.g., asso_denari.png)
  images/semi/          4 suit icon PNGs
```

## Key Patterns

### Socket.IO Client (socketClient.ts)
- Singleton pattern: `getSocket()` creates once, returns same instance
- Transports: `["websocket", "polling"]` with credential cookies
- Reconnection: infinite attempts, 1-5s backoff
- Connection status tracked via listeners: `onConnectionStatusChange(cb)`
- Lobby handlers auto-rejoin on reconnect

### GameTable.tsx (main game page)
- Fetches initial state via REST `GET /api/games/:roomCode/state` on mount
- Subscribes to socket events for real-time updates: card_played, hand_complete, round_ended, etc.
- Player positions mapped to CSS positions: bottom (me), top (partner), left/right (opponents)
- Signal flow: click card → if trick leader, show SignalDialog → then send play-card with signal
- Pending card stored in ref while signal dialog is open
- Timer UI syncs with `turn_timer_started` socket event (server-authoritative timestamp)

### Auth Flow
- AuthDialog handles register + login
- Cookie set by backend, sent automatically via `credentials: 'include'` on fetch and Socket.IO
- `GET /api/users/me` to check auth state on page load
- Redirect to home if not authenticated on protected pages

### Environment
- `VITE_API_URL` — backend REST (e.g., `http://localhost:8000/api`)
- `VITE_SOCKET_URL` — backend socket (e.g., `http://localhost:8000`)

## Build

```bash
npm run build       # vite build → dist/ (static files)
npm run dev         # vite dev server on :8081
```

Vercel auto-detects Vite framework. Set root directory to `frontend/`.
SPA routing handled automatically (all paths → index.html).

## Testing

```bash
npm test                    # Vitest unit tests
npm run test:e2e            # Playwright headless (needs backend + frontend running)
npm run test:e2e:headed     # Watch bots play in real browsers
npx playwright show-report  # HTML report with traces after failures
```

## UI Notes

- All UI text is in Italian
- Card images: `/images/cards/{value}_{suit}.png` where suit uses "denari" (not "denara") in filenames
- shadcn/ui components in `src/components/ui/` — add new ones via `npx shadcn-ui@latest add <name>`
- Animations: card-from-bottom CSS animation used for chat panel and card plays
- Responsive: mobile-friendly layout, cards resize based on viewport
