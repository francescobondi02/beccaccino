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
npm install
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

## Environment variables

| Var | Purpose |
|---|---|
| `VITE_API_URL` | Backend REST base URL, e.g. `http://localhost:8000/api` |
| `VITE_SOCKET_URL` | Backend WebSocket URL, e.g. `http://localhost:8000` |
| `VITE_SENTRY_DSN` | Optional — Sentry DSN for browser error tracking |

Vite bakes these into the bundle at build time. After changing them in Vercel
you must redeploy.

## Deployment

GitHub Actions validates `main`, checks out the exact successful commit, and
uses the pinned Vercel CLI to build and deploy it. Configure repository secrets
with a `VERCEL_TOKEN` scoped to the `beccaccino-client` project. The workflow
resolves that project's IDs through the Vercel API under the
`francesco-bondi-s-projects` scope before building. Direct Vercel Git deployments
are disabled in `vercel.json`, and a missing token fails the deployment workflow.

Production builds require `VITE_API_URL` and `VITE_SOCKET_URL` to be valid HTTPS
URLs and require a commit SHA from Vercel or GitHub Actions. The build writes
that non-secret revision to `/version.json`. After deployment, GitHub Actions
waits for the exact commit and then verifies the frontend document, backend
database readiness, and AI model health.

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
