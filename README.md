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
| `npm run preview` | Preview the production build locally |
| `npm run typecheck` | TypeScript project checks |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |
| `npm run test:coverage` | Vitest unit tests with coverage |
| `npm run test:e2e` | Playwright end-to-end (auto-starts backend and frontend) |
| `../scripts/pre-push.sh` | Full backend, frontend, migration, and Playwright gate |

Run `../scripts/pre-push.sh --keep-open` to leave the verified isolated stack
available at `http://localhost:18081` for manual testing until Ctrl-C.

## Environment variables

| Var | Purpose |
|---|---|
| `VITE_API_URL` | Backend REST base URL, e.g. `http://localhost:8000/api` |
| `VITE_SOCKET_URL` | Development-only Socket.IO URL, e.g. `http://localhost:8000` |
| `VITE_SENTRY_DSN` | Optional — Sentry DSN for browser error tracking |
| `VITE_SENTRY_RELEASE` | Sentry release identifier supplied by the deployment workflow |

Vite bakes these into the bundle at build time. Production Socket.IO connections
always use the page origin; `VITE_SOCKET_URL` only overrides local development.
Source maps are disabled unless `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`,
`SENTRY_PROJECT`, and a release identifier are all present. Configured builds
generate hidden maps, upload them to Sentry, and delete them after upload.

## Deployment

GitHub Actions validates `main`, checks out the exact successful commit, and
uses the pinned Vercel CLI to build and deploy it. Configure repository secrets
with a `VERCEL_TOKEN` scoped to the `beccaccino-client` project. Optional
`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` secrets enable source map
upload during the trusted deployment build. The workflow resolves the Vercel
project IDs through the API under the `francesco-bondi-s-projects` scope before
building. Direct Vercel Git deployments are disabled in `vercel.json`, and a
missing Vercel token fails the deployment workflow.

Production REST defaults to `/api`. Vercel proxies both `/api` and `/socket.io`
to Render, keeping the authentication cookie on the frontend origin. Socket.IO
uses polling if WebSocket cannot connect through the proxy. Builds also
require a commit SHA from Vercel or GitHub Actions and write that non-secret
revision to `/version.json`. After deployment, GitHub Actions waits for the exact
commit and then verifies the frontend document, backend database readiness, and
AI model health.

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

The active application remains V1. `src/v2/` is an unrouted design foundation and
must stay isolated until V2 product ownership and migration are explicitly decided.
