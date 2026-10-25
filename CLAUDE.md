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
    game/                Table board, score header, and game controls
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
  styles/arcade.css      Default arcade theme, shared hero styles, scoped live-page styling
  preview/              Development-only interactive design prototype
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
- The full round history uses `TrickHistoryDialog`; live games expose only the last completed trick
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

- Arcade is the only active interface. `next-themes` forces `html[data-ui="arcade"]`,
  ignoring older `becca-ui` preferences. There is no interface switch or classic lobby.
- `ArcadeHero` and `ArcadeRules` are shared between the real lobby and `/preview`
  (development only). Real room actions continue through `LobbyPage`; never connect
  production routes to the prototype's sample data.
- The anonymous table demo reuses `GameBoard`, `GameScoreHeader`, and `SignalDialog`
  in a full-viewport layout. Circular-table overrides stay scoped to `.club-match-preview`;
  demo actions and four-card tricks are local only.
- `GameBoard` anchors transient comic `SignalCallout` bubbles to each declaring
  player without changing hand/table layout. Persistent signal badges remain.
  The demo's `Fumetti` control previews all players and signals; reduced motion
  and the effects toggle keep bubbles static.
- All UI text is in Italian
- Gameplay, history, annotations, briscola icons, and the table demo use the original
  PNG assets in `public/images/`. Card filenames use "denari", not the DB enum "denara".
- Only the landing hero uses `lobby/LandingCardArtwork.tsx`: five decorative SVG
  illustrations inspired by the existing Italian deck, without poker corner indices.
  Keep these illustrations separate from `PlayingCard` and gameplay.
- Practice games keep "Pausa e torna alla home" and confirmed "Abbandona" in the bottom-right toolbar, anchored below the hand rather than overlaid on a scrolling viewport. Multiplayer offers confirmed permanent abandonment: a bot inherits the same seat and the match still counts in statistics. Neither disconnect nor unmount abandons or pauses a game. Three consecutive timeouts give control to a real bot; socket rejoin or "Riprendi controllo" restores a non-abandoned human seat. `GameActions` is shared by the toolbar, briscola dialog, and round summary. Paused practice links retain blocking resume/abandon controls; finished games use the result's "Torna alla lobby".
- The live table reserves a central grid row for turn, collection, signal, and system messages, without a boxed panel. The partner's card sits above it; the other three cards sit below, away from player seats. The demo retains its circular layout and separate controls. Releasing a completed trick removes only that trick's underlying cards, preserving newer cards received during collection.
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
  `game_finished` and refreshed snapshots carry the same statistics. Show only
  positive-count awards (busso, enemy aces captured, own aces lost), including
  all tied players. Per-round details use native `details`; no new tracking,
  dependencies or permanent medal system. Missing statistics are supported
  during rolling deployment; the existing scores remain visible.
- shadcn/ui components in `src/components/ui/` — add new ones via `npx shadcn-ui@latest add <name>`
- Live card motion uses server events and measured hand/seat positions. Completed
  tricks capture their display winner before the next round changes trump.
  Native animations cancel on unmount or OS reduced motion; restored cards do not
  replay. Effects controls stay in the development preview, never live pages.
- Responsive: mobile-friendly layout, cards resize based on viewport
- Phones play the table in landscape. `(orientation: landscape) and (max-height: 540px)` in
  `arcade.css` moves score/briscola to a left rail and table tools to a right rail of 44px
  icon buttons, keeps the ten-card hand on one row, and compacts in-game dialogs and page chrome.
  Tool labels stay in the accessible name via `.arcade-tool-label`.
  Primary messages keep their central grid row; supplementary signal/system notices use the
  left rail below the score. The local seat stays below the hand, and short landscape
  layouts retain at least 320px of content height rather than clipping controls.
- Portrait phones see `RotateDevicePrompt` over the table, with "Continua in verticale" so
  portrait play stays possible. `lib/fullscreen.ts` requests fullscreen plus a landscape
  orientation lock on phones only (Practice "Gioca", the prompt, and the "Schermo intero"
  tool); iPhone Safari supports neither, so failures are ignored. Leaving the table exits fullscreen.
- `public/manifest.webmanifest` makes the app installable (fullscreen display, any orientation,
  separate maskable icon, wide/narrow screenshots for the richer Android install sheet).
  `public/sw.js`, registered in production only, never caches the app: it passes navigations
  to the network and shows the cached `offline.html` when that fails. Its fetch handler is
  what lets Chrome show its own install prompt. Offline play is deliberately out of scope.
