# Preview

## Overview
Design prototypes with local demo data. `src/App.tsx` lazily imports
`PreviewStudio` and `MobilePreview` only when `import.meta.env.DEV` is true,
mounting them at `/preview/*` and `/preview/mobile/*`; `/preview/profile`
renders `Profile` with `preview` in development. No module here calls the API or
sockets; demo actions change only in-memory React state.

Exception: `profileDemo.ts` is imported statically by the production page
`src/pages/Profile.tsx`, so its demo data ships in production builds (it is
rendered only in development preview mode). `PreviewStudio` and `MobilePreview`
read reduced motion from `@/hooks/useReducedMotion`.

## Interface
- `PreviewStudio` (default export) — desktop "club" landing and demo table switcher [PreviewStudio.tsx:PreviewStudio]
- `PreviewGameTable` (default export) — props `room`, `onBack`, `effectsEnabled`, `motionStopped`, `onToggleEffects`, optional `mobile`, `localUsername = "Alex"`, `onFinish`; reuses `GameBoard`, `GameScoreHeader`, `SignalDialog` and `ArcadeRules` [PreviewGameTable.tsx:PreviewGameTable]
- `MobilePreview` (default export) — landscape mobile prototype routed by the path after `/preview/mobile` (`home`, `room`, `table`, or a `MobilePages` page); header tools link to `/preview/mobile/lobby` and `/preview/mobile/leaderboard`, open the rules, and show a fullscreen button only when `canEnterGameFullscreen()` is true [MobilePreview.tsx:MobilePreview]
- `MobilePages` (default export) — props `page`, `username`, `onAccount`, `onOpenRoom`, `onStartPractice`; renders `lobby`, `practice`, `leaderboard`, `profile`, `account`, `result` (shared `GameResult` with demo data) or a local not-found panel [MobilePages.tsx:MobilePages]
- `profileDemo` — `{ user, stats }` demo data typed with `UserStats` from `src/pages/Profile.tsx` [profileDemo.ts:profileDemo]

## Invariants
- Demo tables use a fixed hand and four fixed players; "Completa la presa" fills the trick locally with three cards of the led suit [PreviewGameTable.tsx:hand], [PreviewGameTable.tsx:PreviewGameTable]
- Signal callouts in the demo ("Fumetti") are local simulations only; the dialog text states no server action happens [PreviewGameTable.tsx:PreviewGameTable]
- `MobilePreview` shows a non-dismissible rotate dialog while `(pointer: coarse) and (orientation: portrait)` matches; its "Apri a schermo intero" button is also gated by `canEnterGameFullscreen()` [MobilePreview.tsx:PORTRAIT_TOUCH], [MobilePreview.tsx:MobilePreview]
- In the mobile room demo, changing team or bot tier resets "ready"; the table opens only when ready and a bot tier is chosen [MobilePreview.tsx:MobilePreview]
- Account and profile forms in `MobilePages` only update the in-memory username (min 3 / max 32 characters; password min 6, never stored or sent) [MobilePages.tsx:MobilePages]
- Unknown mobile pages render "Questo tavolo non esiste." [MobilePages.tsx:MobilePages]
- Effects toggle and OS reduced motion both stop motion (`motionStopped = reduceMotion || !effectsEnabled`) [PreviewStudio.tsx:PreviewStudio], [MobilePreview.tsx:MobilePreview]

## Side Effects
- Router navigation within `/preview/mobile/*` [MobilePreview.tsx:MobilePreview], [MobilePages.tsx:MobilePages]
- DOM focus management when switching views; only `PreviewStudio` also calls `window.scrollTo`, while `MobilePreview` only focuses the page heading [PreviewStudio.tsx:PreviewStudio], [MobilePreview.tsx:MobilePreview]
- `PreviewGameTable` uses `requestAnimationFrame` to focus the reset button after a signal is chosen [PreviewGameTable.tsx:PreviewGameTable]
- `window.matchMedia` orientation subscription and optional `enterGameFullscreen()` [MobilePreview.tsx:subscribeToOrientation], [MobilePreview.tsx:MobilePreview]
- Imports stylesheets `src/styles/arcade.css` and `./mobile-preview.css` [PreviewStudio.tsx:PreviewStudio], [MobilePreview.tsx:MobilePreview]

## Verification
- Run: `cd frontend && npx vitest run src/__tests__/pages/PreviewStudio.test.tsx`
- Run: `cd frontend && npm run typecheck && npm run lint`
