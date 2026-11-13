# Frontend Source (`src/`)

## Overview
Source of the React single-page application. `main.tsx` mounts `App` inside an
`ErrorBoundary`; `App.tsx` sets up TanStack Query, the forced `arcade` theme,
the toaster, the app-update check and the React Router route table. Feature code is split into pages,
components, hooks, pure state modules and the Socket.IO client layer.

## Interface
- `main.tsx` — renders `<ErrorBoundary><App /></ErrorBoundary>` into `#root`, imports `index.css`, and registers `/sw.js` in production [main.tsx:createRoot]
- `App` (default export) — calls `useAppUpdate()`, then renders providers and routes [App.tsx:App]:
  - Live routes (children of a pathless layout route rendering `<div className="arcade-app"><RotateDevicePrompt /><Outlet /></div>`): `/` `LobbyPage`, `/room/:roomCode` `GameRoom`, `/game/:gameRoomCode` `GameTable`, `/profile` `Profile`, `/leaderboard` `Leaderboard`, `/practice` `Practice`, `/annotate` `Annotation`, `*` `NotFound`
  - Development-only routes: `/preview/profile` (`Profile preview`), `/preview/mobile/*` (`MobilePreview`), `/preview/*` (`PreviewStudio`)
- `vite-env.d.ts` — Vite client type reference [vite-env.d.ts:vite/client]
- Subdirectories:
  - [annotations](./annotations/README.md) — expert annotation API model and pure presentation helpers.
  - [components](./components/README.md) — shared and feature components, including shadcn/ui primitives.
  - [game](./game/README.md) — game DTOs, presentation selectors and the table reducer.
  - [hooks](./hooks/README.md) — auth, connection status, lobby, waiting room, game-table coordination, app-update check, mobile-table and reduced-motion media queries.
  - [lib](./lib/README.md) — REST client, room-conflict redirect, fullscreen, `cn`.
  - [pages](./pages/README.md) — route screens.
  - [preview](./preview/README.md) — development design prototypes (`profileDemo.ts` is also imported by the production `Profile` page).
  - [rooms](./rooms/README.md) — room DTOs and pure lobby/waiting-room reducers.
  - [sockets](./sockets/README.md) — typed Socket.IO contract and client.
  - `styles/` (CSS only: `arcade.css` and `mobile-app.css` imported by `App.tsx`; `mobile-table.css` imported by `pages/GameTable.tsx` for the mobile live table) and `__tests__/` (Vitest suites) have no contract file.

## Invariants
- The UI theme is forced: `ThemeProvider` with `attribute="data-ui"`, `forcedTheme="arcade"`, `storageKey="becca-ui"`, system theme disabled [App.tsx:App]
- Route-level pages other than `LobbyPage` and `NotFound` are lazy-loaded behind one `Suspense` spinner [App.tsx:GameRoom], [App.tsx:App]
- `App` imports the preview routes (`PreviewStudio`, `MobilePreview`) only when `import.meta.env.DEV` is true [App.tsx:PreviewStudio], [App.tsx:MobilePreview]; `preview/profileDemo.ts` is the exception, imported statically by `pages/Profile.tsx` and therefore bundled in production
- Toasts: one visible at a time, 2500 ms duration [App.tsx:App]
- The service worker is registered only when `import.meta.env.PROD` and `serviceWorker` is supported [main.tsx:createRoot]
- `RotateDevicePrompt` is mounted once by the layout route, so it covers every live route but not the preview routes [App.tsx:RotateDevicePrompt]

## Side Effects
- Mounts React into `document.getElementById("root")` [main.tsx:createRoot]
- `navigator.serviceWorker.register("/sw.js")` on window `load` in production [main.tsx:createRoot]
- Creates one `QueryClient` for the app lifetime [App.tsx:queryClient]
- In production, polls `/version.json` through `useAppUpdate` (see [hooks](./hooks/README.md)) [App.tsx:useAppUpdate]
- Global CSS imports: `index.css`, `styles/arcade.css`, `styles/mobile-app.css`; `styles/mobile-table.css` loads with the lazy `GameTable` chunk [main.tsx:createRoot], [App.tsx:App], [pages/GameTable.tsx:mobile-table.css]

## Verification
- Run: `cd frontend && npm test`
- Run: `cd frontend && npm run typecheck && npm run lint`
