# Frontend — React + Vite + shadcn/ui

React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui components. Single-page application.

## Structure

```
src/
  main.tsx              Entry: renders App in ErrorBoundary
  App.tsx               Providers, useAppUpdate, routes
  pages/
    LobbyPage.tsx       Home/lobby: auth dialog, create/join room, animated card background
    GameRoom.tsx        Room lobby: team selection, ready up, waiting for 4 players
    GameTable.tsx       Main game: card hands, trick area, timers, and dialogs
    Profile.tsx         User profile and stats
    Leaderboard.tsx     Global leaderboard
    Practice.tsx        Tier picker: start a game vs 3 AI bots
    NotFound.tsx        404 page
  components/
    game/                Table board, score header, game controls
    lobby/               Lobby actions, room lists, and decorative background
    rooms/               Waiting-room player presentation
    AuthDialog.tsx      Login/register modal
    Header.tsx          Nav bar with auth state
    PlayingCard.tsx     Single card renderer (suit + value → original image)
    TrumpSuitDialog.tsx Briscola selection (4 suit buttons + hand preview)
    SignalDialog.tsx     Signal declaration (striscio/busso/volo/niente)
    SignalBadge.tsx     Declared signal, shown on every seat
    GameChat.tsx        In-game chat panel (Socket.IO)
    LastTrickDialog.tsx View last completed trick
    RoundEndDialog.tsx  Round score summary
    GameResult.tsx        Full-page final scores, team stats and match awards
    ui/                 shadcn/ui components (don't edit manually — use CLI to add new ones)
  sockets/
    socketClient.ts     Singleton Socket.IO client, reconnection logic, status tracking
    lobbyHandlers.ts    Lobby socket subscription: lobby_changed
    roomHandlers.ts     Room join/leave and game_state, room_changed, chat events
  hooks/
    useAppUpdate.ts     Production /version.json polling and reload toast
    useAuth.ts          Shared authentication state and actions
    useConnectionStatus.ts Socket status and reconnect refresh
    useGameTable.ts     Game table state and socket coordination
    useLobbyRooms.ts    Lobby room hydration and socket coordination
    useReducedMotion.ts OS reduced-motion preference
    useRoundDeal.ts     Round deal presentation phases
    useTurnCountdown.ts Server-authoritative timer presentation
    useWaitingRoom.ts   Waiting-room hydration and socket coordination
  game/                 Presentation selectors
  rooms/                Waiting-room presentation selectors
  lib/
    api.ts              Typed REST helpers and ApiError
    roomRedirect.ts     Active-room conflict navigation
    utils.ts            cn() utility for Tailwind class merging
  styles/arcade.css      Default arcade theme, shared hero styles, scoped live-page styling
  __tests__/            Vitest unit tests for components and socket handlers
e2e/
  helpers/
    BotPlayer.ts        Playwright helper: headless player that can register, join, play
    fixtures.ts         Multi-browser test fixtures (4 independent contexts)
  lobby-to-game.spec.ts  4 players: register → room → teams → ready → game starts
  first-trick.spec.ts    Briscola selection and the first 4-card trick
  full-game.spec.ts      4 players finish a game (GAME_WIN_POINTS=5; CI on main only)
  practice-pause-resume.spec.ts Practice pause, resume, direct links, and abandon
  arcade-ui.spec.ts      Arcade layout, recap, results, and rules
  game-motion.spec.ts    Table layout and card travel/collection animations
public/
  images/cards/         40 card PNGs (format: {value}_{suit}.png, e.g., asso_denari.png)
  images/semi/          4 suit icon PNGs
```

## Key Patterns

### Responsibility boundaries
- Pages adapt routes and authentication, execute user commands, and compose views.
- Hooks coordinate REST, Socket.IO, and reconnect behavior.
- Selectors are pure and independently tested.
- Wire types come from `backend/src/contract` via the `@contract/*` path.
- Feature view components receive data and callbacks; they do not fetch or subscribe.

### Socket.IO Client (socketClient.ts)
- Singleton pattern: `getSocket()` creates once, returns same instance
- Transports: `["websocket", "polling"]` with credential cookies
- Reconnection: infinite attempts, 1-5s backoff
- Connection status tracked via listeners: `onConnectionStatusChange(cb)`
- Lobby handlers auto-rejoin on reconnect

### GameTable.tsx (main game page)
- Composes the active table from `useGameTable`, pure selectors, and focused
  game components
- `useGameTable` keeps the full `GameState` in React Query `["game", code]`:
  `GET /api/games/:roomCode/state`, `game_state` pushes and mutation responses
  all go through `keepNewer` (higher `version` wins); `room_changed` and
  reconnect refetch. Notices come from `lastAction`.
- Player positions mapped to CSS positions: bottom (me), top (partner), left/right (opponents)
- Signal flow: click card → if trick leader, show SignalDialog → then `POST /api/games/:code/cards` with the signal
- The pending leader card is held in `pendingCard` state; the signal choice is open while it is set and no card is being sent
- Timer UI uses `turn.deadline`, corrected by `serverTime` for clock skew

### Auth Flow
- AuthDialog handles register + login
- Cookie set by backend, sent automatically because fetch and Socket.IO are same-origin
- `GET /api/users/me` to check auth state on page load
- Redirect to home if not authenticated on protected pages (`GameRoom` redirects to `/?join=CODE`)
- Invite links (`/room/:code`) join non-members via `POST /rooms/:code/join`; signed-out
  visitors land on `/?join=CODE` with the code prefilled
- The singleton socket is dropped whenever the signed-in user changes

### Environment
- Backend origin and `BACKEND_URL`: see [README.md](./README.md#environment-variables)

## Build

```bash
npm run typecheck   # TypeScript project checks
npm run build       # vite build -> dist/ (static files)
npm run dev         # vite dev server on :8081
```

CI: `.github/workflows/frontend.yml` (path-filtered). Production deploys are not automated yet.
SPA routing is handled by `vercel.json`.

Each build generates a random UUID: Vite bakes it in as
`import.meta.env.VITE_APP_VERSION`, and the `app-version` plugin in
`vite.config.ts` emits `dist/version.json` (`{ "version": "<uuid>" }`). It is not
a commit SHA. In production `useAppUpdate` polls `/version.json` (no-store) on load,
every 60 s and when the tab becomes visible, and shows one persistent
"Aggiornamento disponibile" toast with a "Ricarica" action when the id differs.

## Testing

```bash
npm test                    # Vitest unit tests
npx playwright test         # Playwright headless (no npm script; auto-starts backend + frontend)
npx playwright test --headed # Watch bots play in real browsers
npx playwright show-report  # HTML report with traces after failures
```

## UI Notes

- Arcade is the only interface: `index.html` sets `html[data-ui="arcade"]`.
  There is no interface switch or classic lobby. The website supports windows of
  at least 1024×600 px; phones and tablets use the native app in `../mobile`.
- `ArcadeHero` and `ArcadeRules` belong to the real lobby; room actions go through `LobbyPage`.
- `GameBoard` anchors transient comic `SignalCallout` bubbles to each declaring
  player without changing hand/table layout. Persistent signal badges remain.
  Reduced motion keeps bubbles static.
- All UI text is in Italian
- Gameplay, history and briscola icons use the original
  PNG assets in `public/images/`. Card filenames use "denari", not the DB enum "denara".
- Only the landing hero uses `lobby/LandingCardArtwork.tsx`: five decorative SVG
  illustrations inspired by the existing Italian deck, without poker corner indices.
  Keep these illustrations separate from `PlayingCard` and gameplay.
- Practice games keep "Pausa e torna alla home" and confirmed "Abbandona" in the bottom-right toolbar, anchored below the hand rather than overlaid on a scrolling viewport. Multiplayer offers confirmed permanent abandonment: a bot inherits the same seat and the match still counts in statistics. Neither disconnect nor unmount abandons or pauses a game. Three consecutive timeouts give control to a real bot; only "Riprendi controllo" restores a non-abandoned human seat (reconnecting does not). `GameActions` is shared by the toolbar, briscola dialog, and round summary. Paused practice links retain blocking resume/abandon controls; finished games use the result's "Torna alla lobby".
- The live table reserves central space for turn, collection, signal, and system messages, without a boxed panel. Cards form a cross: partner above, opponents beside the messages, self below, leaving player seats clear. Releasing a completed trick removes only that trick's underlying cards, preserving newer cards received during collection.
- Live games retain chat and "Ultima presa", which displays only the previous completed trick's four cards. No full practice history or revealed-hand controls, including in development.
- Round starts enter the table immediately. The server's `round.deal` snapshot
  reserves 2.4 seconds to distribute cards to all seats and 1.6 seconds to read
  the hand before briscola selection. Later rounds first retain the completed
  score summary for 4 seconds instead of adding another collection pause.
  Live last tricks collect within the first second of that existing window,
  before the recap; ordinary tricks retain their 3-second hold.
  `roundSummary` comes from the same snapshot, including after refresh.
  Remaining time is anchored to the client clock, so
  reconnect does not replay the deal. Reduced motion keeps the reading time
  without flying cards; practice controls remain available throughout.
- Finished results replace the table after any live last-trick collection,
  without a new route or automatic dismissal. Restored results appear immediately.
  Every `GameState` with a `result` carries the statistics. Show only
  positive-count awards (busso, enemy aces captured, own aces lost), including
  all tied players. Per-round details use native `details`; no new tracking,
  dependencies or permanent medal system.
- shadcn/ui components in `src/components/ui/` — add new ones via `npx shadcn-ui@latest add <name>`
- Live card motion uses server events and measured hand/seat positions. Completed
  tricks capture their display winner before the next round changes trump.
  Native animations cancel on unmount or OS reduced motion; restored cards do not
  replay.
