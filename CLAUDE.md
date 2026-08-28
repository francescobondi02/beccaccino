# Frontend — React + Vite + shadcn/ui

React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui components. Single-page application.

## Structure

```
src/
  main.tsx              Entry: renders App
  App.tsx               BrowserRouter with routes
  pages/
    LobbyPage.tsx       Home/lobby: auth dialog, create/join room, animated card background
    GameRoom.tsx        Room lobby: team selection, ready up, waiting for 4 players
    GameTable.tsx       Main game: card hands, trick area, timers, and dialogs
    Profile.tsx         User profile and stats
    Leaderboard.tsx     Global leaderboard
    Practice.tsx        Tier picker: start a game vs 3 AI bots
    Annotation.tsx      Account login, shared-code gate, and scenario labeling
    NotFound.tsx        404 page
  components/
    AnnotationScenario.tsx Shared scenario context with card/signal or briscola decisions
    annotation/          Annotation summary, trick, selection, and response views
    game/                Table board, score header, and practice controls
    lobby/               Lobby actions, room lists, and decorative background
    rooms/               Waiting-room player presentation
    AuthDialog.tsx      Login/register modal
    Header.tsx          Nav bar with auth state
    PlayingCard.tsx     Single card renderer (suit + value → image)
    TrumpSuitDialog.tsx Briscola selection (4 suit buttons + hand preview)
    SignalDialog.tsx     Signal declaration (striscio/busso/volo/niente)
    SignalBadge.tsx     Declared signal, shown on every seat
    PracticeHistoryDialog.tsx Development-only practice history dialog
    GameChat.tsx        In-game chat panel (Socket.IO)
    LastTrickDialog.tsx View last completed trick
    RoundEndDialog.tsx  Round score summary
    GameFinishedDialog.tsx  Game over with final scores
    ui/                 shadcn/ui components (don't edit manually — use CLI to add new ones)
  sockets/
    events.ts           Typed client/server event contract
    socketClient.ts     Singleton Socket.IO client, reconnection logic, status tracking
    lobbyHandlers.ts    Lobby socket events: room_created, room_updated, room_full, room_deleted
    roomHandlers.ts     Room socket events: join, leave, team, ready, game start
  hooks/
    useAuth.ts          Shared authentication state and actions
    useConnectionStatus.ts Socket status and reconnect refresh
    useGameTable.ts     Game table state and socket coordination
    useLobbyRooms.ts    Lobby room hydration and socket coordination
    useTurnCountdown.ts Server-authoritative timer presentation
    useWaitingRoom.ts   Waiting-room hydration and socket coordination
  game/                 Game DTOs, reducer state, and presentation selectors
  annotations/          Expert annotation API model types
  rooms/                Room DTOs, normalization, and pure state reducers
  v2/                   Unrouted V2 design foundation
  lib/
    api.ts              Typed REST helpers and ApiError
    roomRedirect.ts     Active-room conflict navigation
    sentryUser.ts       Browser error-reporting identity
    utils.ts            cn() utility for Tailwind class merging
  assets/               Static images used in components
  __tests__/            Vitest unit tests for components and socket handlers
e2e/
  helpers/
    BotPlayer.ts        Playwright helper: headless player that can register, join, play
    fixtures.ts         Multi-browser test fixtures (4 independent contexts)
  lobby-to-game.spec.ts  4 players: register → room → teams → ready → game starts
  first-trick.spec.ts    Briscola selection and the first 4-card trick
  annotation.spec.ts     Account-linked expert answer and skip workflow
  practice-pause-resume.spec.ts Practice pause, resume, direct links, and abandon
public/
  images/cards/         40 card PNGs (format: {value}_{suit}.png, e.g., asso_denari.png)
  images/semi/          4 suit icon PNGs
```

## Key Patterns

### Responsibility boundaries
- Pages adapt routes and authentication, execute user commands, and compose views.
- Hooks coordinate REST, Socket.IO, and reconnect behavior.
- Reducers and selectors are pure and independently tested.
- Feature view components receive data and callbacks; they do not fetch or subscribe.
- V2 is not part of the active router. Keep it isolated until product migration is explicit.

### Socket.IO Client (socketClient.ts)
- Singleton pattern: `getSocket()` creates once, returns same instance
- Transports: `["websocket", "polling"]` with credential cookies
- Reconnection: infinite attempts, 1-5s backoff
- Connection status tracked via listeners: `onConnectionStatusChange(cb)`
- Lobby handlers auto-rejoin on reconnect

### GameTable.tsx (main game page)
- Composes the active table from `useGameTable`, pure selectors, and focused
  game components
- `useGameTable` fetches `GET /api/games/:roomCode/state` and reconciles
  card, hand, round, timer, and practice lifecycle events
- Player positions mapped to CSS positions: bottom (me), top (partner), left/right (opponents)
- Signal flow: click card → if trick leader, show SignalDialog → then send play-card with signal
- Pending card stored in ref while signal dialog is open
- Timer UI syncs with `turn_timer_started` socket event (server-authoritative timestamp)

### Auth Flow
- AuthDialog handles register + login
- Cookie set by backend, sent automatically via `credentials: 'include'` on fetch and Socket.IO
- `GET /api/users/me` to check auth state on page load
- Redirect to home if not authenticated on protected pages

### Expert Annotation Flow
- `/annotate` is lazy-loaded and uses the normal BECCA registration/login flow
- The shared code grants expert access to the authenticated account
- REST loads `/annotations/status`, then `/annotations/next`
- The acting seat is always rendered at the bottom and scores convert raw thirds
  into points plus figures
- The full round history reuses `TrickHistoryDialog`, shared with practice games
- Card, signal, and briscola options come only from `scenario.legalActions`
- Leaders must choose an explicit signal, including `Niente`; followers do not
  receive a signal prompt
- Briscola scenarios show the caller, team scores, and full hand with four suit
  choices, without a current trick, history, or preselected briscola
- `Non sono sicuro` opens an optional 500-character comment dialog
- Every answer or skip asks for easy, medium, or hard perceived difficulty
- Responses include scenario id and state hash, selected action or skip,
  perceived difficulty, optional skip comment, and client response time
- Show an open-ended contribution count, never a target or completion total
- Do not display predicted difficulty, importance, tags, model outputs, or
  suggested actions

### Environment
- `VITE_API_URL` — backend REST (e.g., `http://localhost:8000/api`)
- `VITE_SOCKET_URL` — backend socket (e.g., `http://localhost:8000`)

## Build

```bash
npm run typecheck   # TypeScript project checks
npm run build       # vite build -> dist/ (static files)
npm run dev         # vite dev server on :8081
```

GitHub Actions deploys the exact successful `main` commit with the pinned
Vercel CLI and then verifies `/version.json`. Direct Vercel Git deployments
are disabled. SPA routing is handled by `vercel.json`.

## Testing

```bash
npm test                    # Vitest unit tests
npm run test:e2e            # Playwright headless (auto-starts backend + frontend)
npm run test:e2e:headed     # Watch bots play in real browsers
npx playwright show-report  # HTML report with traces after failures
```

## UI Notes

- All UI text is in Italian
- Card images: `/images/cards/{value}_{suit}.png` where suit uses "denari" (not "denara") in filenames
- Practice games show "Pausa e torna alla home" alongside the confirmed, destructive "Abbandona" action, including inside the mandatory briscola and signal dialogs. Paused practice games appear under "Allenamenti in pausa" on the home page and must be resumed before opening; direct paused game links show blocking resume/abandon controls. Pausing is explicit only, never triggered by disconnect or unmount. Multiplayer games have no mid-game exit; once finished, both use the results dialog's "Torna alla Home".
- When running the Vite dev server (`npm run dev`, where `import.meta.env.DEV` is true), practice games show a history icon that opens the large `PracticeHistoryDialog`. It groups played cards by trick, using card images with player names and declared signals, and clears when a new deck is dealt. Revealed hands are opt-in, hidden by default, and reset when the dialog closes. There is no practice side rail or table layout shift.
- shadcn/ui components in `src/components/ui/` — add new ones via `npx shadcn-ui@latest add <name>`
- Animations: card-from-bottom for chat; directional table-card animations for plays
- Responsive: mobile-friendly layout, cards resize based on viewport
