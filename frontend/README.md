# Beccaccino — Frontend

React 18 + Vite + TypeScript + Tailwind + shadcn/ui. Real-time multiplayer Italian
card game UI. Connects to the Express + Socket.IO backend over REST + WebSocket.

Invited experts use their normal BECCA account at `/annotate` to label game
scenarios. The workflow keeps the acting player at the bottom, validates
choices against server-provided legal actions, records explicit leader
signals, asks for perceived difficulty, and keeps an open-ended contribution
count.

## Quick start

```bash
cp .env.example .env   # fill in VITE_API_URL and VITE_SOCKET_URL
npm ci
npm run dev            # http://localhost:8081
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Production build → `dist/` |
| `npm run build:dev` | Build in Vite `development` mode |
| `npm run preview` | Preview the production build locally |
| `npm run typecheck` | TypeScript project checks |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |
| `npx playwright test` | Playwright end-to-end (no npm script; see `playwright.config.ts`) |

## Environment variables

| Var | Purpose |
|---|---|
| `VITE_API_URL` | Production REST base URL (default `/api`), e.g. `http://localhost:8000/api`; in development only the Vite proxy fallback origin |
| `VITE_SOCKET_URL` | Development-only Vite proxy origin for `/api` and `/socket.io`, e.g. `http://localhost:8000` |

Only `VITE_API_URL` is read by application code, and Vite bakes it into the
production bundle at build time. Production Socket.IO connections always use the
page origin. No Sentry or other error-reporting integration exists.

## Deployment

`.github/workflows/ci.yml` (CI) runs on pushes to `main` and `develop` and on
pull requests: Node 24, `npm ci`, `npm run typecheck`, `npm run lint`,
`npm test`, `npm run build`.

`.github/workflows/deploy.yml` runs when CI completes for a push to `main` and
only if CI succeeded. It checks out the exact CI commit (`head_sha`), runs
`npm ci`, installs the pinned Vercel CLI (`vercel@59.7.0`), then runs
`vercel pull --environment=production`, `vercel build --prod` and
`vercel deploy --prebuilt --prod`. It reads the repository secrets
`VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` directly. There is no
post-deploy verification step. Direct Vercel Git deployments are disabled in
`vercel.json`.

Each build emits `dist/version.json` with a random build UUID (not a commit
SHA) through the `app-version` plugin in `vite.config.ts`. Open production tabs
poll it and offer a reload when it changes (`src/hooks/useAppUpdate.ts`).

Production REST defaults to `/api`. Vercel forwards REST and Socket.IO polling
to Render through external rewrites. WebSocket upgrades on `/socket.io/` use
`api/socket-proxy.ts`, a Vercel Function that bridges to Render and forwards the
existing HttpOnly authentication cookie. The bridge accepts only the same HTTPS
origin as the request host; backend session validation remains unchanged.
Only `authToken` is forwarded, not Vercel's platform cookies. Routing matches
Socket.IO's `transport=websocket` query; polling keeps its external rewrite.
No browser token storage or cross-site cookies are required.

The function uses Fluid compute with a 300-second maximum duration. Vercel closes
connections at that limit; the existing Socket.IO reconnect and room hydration
must restore the session. Polling remains available when WebSocket cannot connect.
Before production promotion, verify authenticated events and reconnects through a
Vercel deployment, including a connection lasting beyond five minutes. Local
tests do not prove Vercel's routing or runtime behavior. Function CPU, memory and
data transfer contribute to Vercel usage.

## Expert annotation

The `/annotate` page uses the normal registration and login flow. It then asks
for the private shared code once and stores expert access on the account, so
responses and the contribution count follow the user across browsers. The UI
does not impose or display a target number of scenarios. Only submitted
responses are persisted; an unfinished card selection or draft comment is not.
It calls:

- `POST /annotations/access`
- `GET /annotations/status`
- `GET /annotations/next`
- `POST /annotations/responses`

Scenario labels come from either the expert's card and signal selection or a
briscola suit selection, according to the scenario decision type. Every answer
or skip includes an easy, medium, or hard rating. `Non sono sicuro` also
accepts an optional short comment. The UI does not render the backend's
predicted difficulty, importance, tags, or model suggestions.

## Architecture

- Pages adapt routes and authentication, invoke named commands, and compose views.
- Hooks coordinate REST hydration, Socket.IO reconciliation, and reconnect recovery.
- Feature reducers under `src/game/` and `src/rooms/` contain pure state transitions.
- Components under `components/game`, `components/lobby`, `components/rooms`, and
  `components/annotation` render focused views and receive explicit callbacks.
- `src/lib/api.ts` and the typed socket modules are the transport boundaries.

`src/preview/profileDemo.ts` is imported by the production `src/pages/Profile.tsx`
and ships in production builds.

## Interface

Subdirectory contracts:

- [src](./src/) — application source: entry point, route table, and links to every feature module.
- [api](./api/) — Vercel Function `api/socket-proxy.ts` (WebSocket bridge to Render).
- [server](./server/) — `createSocketProxy(target)` implementation used by the function.
- `public/` — static assets; see [Static assets (`public/`)](#static-assets-public).
- `e2e/` (Playwright specs and helpers) and `src/__tests__/` (Vitest suites) are test-only and have no contract file.

Root configuration files:

- `index.html` — HTML shell with `#root`, loads `/src/main.tsx`, links `/manifest.webmanifest` and icons [index.html:root]
- `vite.config.ts` — dev server on `::`:8081 proxying `/api` and `/socket.io` (with `ws`) to the origin of `VITE_SOCKET_URL` or `VITE_API_URL` (default `http://localhost:8000`); `@` alias to `src`; manual chunks `vendor`, `ui`, `socket`. Each Vite run generates one random build id (`randomUUID()`), exposes it as `import.meta.env.VITE_APP_VERSION`, and the `app-version` plugin emits `version.json` (`{ "version": "<uuid>" }`) into the build output [vite.config.ts:server.proxy], [vite.config.ts:manualChunks], [vite.config.ts:app-version]
- `vitest.config.ts` — jsdom environment, setup `src/__tests__/setup.ts`, includes `src/**/*.{test,spec}.{ts,tsx}` and `server/**/*.test.ts` (node environment), coverage thresholds 70/70/60/70 excluding `src/components/ui/**` [vitest.config.ts:test]
- `playwright.config.ts` — `testDir: ./e2e`, one worker, 60 s test timeout, base URL `E2E_BASE_URL` or `http://localhost:8081`; on CI, `forbidOnly` and 1 retry; HTML report in `PLAYWRIGHT_REPORT_DIR` (default `playwright-report`), output in `PLAYWRIGHT_OUTPUT_DIR` (default `test-results`); unless `E2E_EXTERNAL_SERVERS=true` it starts `cd ../backend && npm run dev:e2e` and `npm run dev`, reusing running servers only when `E2E_REUSE_SERVERS=true` [playwright.config.ts:webServer]
- `vercel.json` — rewrites `/socket.io/?transport=websocket` to `/api/socket-proxy`, `/api/*` and other `/socket.io/` traffic to `https://beccaccino-server.onrender.com`, everything except `/assets/` and `/version.json` to `/index.html`; Git deployments disabled; `Cache-Control: no-store` for `/version.json`, security headers, and immutable caching for `/assets/` [vercel.json:rewrites], [vercel.json:git.deploymentEnabled]
- `components.json` — shadcn/ui configuration (aliases `@/components`, `@/lib/utils`, `@/components/ui`) [components.json:aliases]
- `eslint.config.js`, `tsconfig*.json`, `tailwind.config.ts`, `postcss.config.js` — lint, type-check and styling configuration.
- `.github/workflows/ci.yml`, `.github/workflows/deploy.yml` — CI and production deployment (see [Deployment](#deployment)).

### Static assets (`public/`)

Vite and Vercel serve these files at the site root. The build copies every file
here verbatim into `dist/`, so keep documentation out of this directory.

- `sw.js` — service worker; registered from `src/main.tsx` only in production (`navigator.serviceWorker.register("/sw.js")`) [public/sw.js:fetch]
- `offline.html` — standalone Italian offline page with a "Riprova" (reload) button [public/offline.html:Riprova]
- `manifest.webmanifest` — "Beccaccino Online" / "Becca", `display: "fullscreen"`, `orientation: "landscape"`, icons `/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/icon-maskable-512.png` (maskable), and wide/narrow screenshots in `/screenshots/` [public/manifest.webmanifest:display]
- `icons/icon.svg` and `icons/apple-touch-icon.png` — linked from `index.html` (SVG icon and Apple touch icon), not from the manifest; `favicon.ico` is the 32×32 icon [index.html:root]
- `images/cards/` — 40 card PNGs named `<value>_<suit>.png` with the suit spelled `denari`; `images/semi/` — four suit icons `<suit>_seme.png` with the enum spelling `denara`
- `robots.txt` — allows all crawlers [public/robots.txt:User-agent]
- `version.json` is not a source file: `npm run build` emits `dist/version.json` through the `app-version` plugin in `vite.config.ts`. The `.gitignore` entry for `public/version.json` is a leftover; nothing writes that path [vite.config.ts:app-version]

Invariants:

- The service worker never serves the app from cache: it ignores non-navigation requests and only falls back to the cached `/offline.html` when a navigation fetch fails [public/sw.js:fetch]
- On install it caches only `/offline.html` in cache `becca-offline-v1` and calls `skipWaiting()`; on activate it deletes every other cache and claims clients [public/sw.js:install], [public/sw.js:activate]
- Card image names must match `PlayingCard` (`src/components/PlayingCard.tsx`); suit icons are referenced as `/images/semi/<enum suit>_seme.png`

## Invariants

- In development the REST base is always `/api` (proxied by Vite); in production it is `VITE_API_URL` or `/api` [src/lib/api.ts:API_URL]
- The Socket.IO client always connects to `window.location.origin` with path `/socket.io/` [src/sockets/socketClient.ts:SOCKET_URL]
- All REST calls send cookies (`credentials: "include"`); the socket uses `withCredentials: true` [src/lib/api.ts:request], [src/sockets/socketClient.ts:getSocket]
- The WebSocket bridge accepts only same-origin HTTPS upgrades and forwards only the `authToken` cookie [server/socketProxy.ts:createSocketProxy]
- The service worker is registered only in production and never caches the app itself [src/main.tsx:createRoot], [public/sw.js:fetch]
- Production clients compare `/version.json` with the build id baked into their bundle and offer a reload toast when they differ; the id is a random UUID per build, not a commit SHA, so every rebuild counts as an update [src/hooks/useAppUpdate.ts:useAppUpdate], [vite.config.ts:randomUUID]
- Development-only preview routes are excluded from production builds by `import.meta.env.DEV` checks [src/App.tsx:App]; `src/preview/profileDemo.ts` still ships because `src/pages/Profile.tsx` imports it statically

## Side Effects

- Browser REST and Socket.IO traffic to the backend through `/api` and `/socket.io/` (see [src/](./src/)).
- In production on Vercel: outbound WebSocket connections from the `api/socket-proxy` function to Render [api/socket-proxy.ts:default]
- Browser Cache Storage use by `public/sw.js` [public/sw.js:install]
- In production, `GET /version.json` (no-store) on load, every 60 s and when the page becomes visible [src/hooks/useAppUpdate.ts:useAppUpdate]

## Verification

- Run: `cd frontend && npm test` (Vitest)
- Run: `cd frontend && npm run typecheck`
- Run: `cd frontend && npm run lint`
- Run: `cd frontend && npm run build`
- End-to-end: `cd frontend && npx playwright test` (uses `playwright.config.ts`).
