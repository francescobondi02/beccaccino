# Beccaccino — Frontend

React 18 + Vite + TypeScript + Tailwind + shadcn/ui. Real-time multiplayer Italian
card game UI. Connects to the Express + Socket.IO backend over REST + WebSocket.

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

Auto-deploys to Vercel from the `main` branch. The included `vercel.json` sets
SPA rewrites and security headers.
