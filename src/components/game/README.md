# Game Components

## Overview
Views for the live game table: the board (seats, trick area, hand, deal and
trick-collection animations), the score header, the pause/abandon toolbar, the
paused-practice dialog, signal speech bubbles, and the portrait-rotation prompt.
State comes from props (`src/game/` types); no component here fetches data.
`GameBoard` reads reduced motion from `@/hooks/useReducedMotion`.

## Interface
- `GameBoard` (default export) — props `players`, `currentTurnUserId`, `currentSignal`, `countdown`, `playedCards`, `briscola`, `callerUserId`, `currentUserId`, `hand`, `playableCards`, `onCardClick`, optional `deal`, `animatedCard`, `completedTrick`, `fastCollection`, `notice`, `children` [GameBoard.tsx:GameBoard]
- `GameScoreHeader` (default export) — props `roomCode`, `briscola`, `roundNumber`, `handNumber`, `playerTeam`, `totalPoints` [GameScoreHeader.tsx:GameScoreHeader]
- `GameActions` (default export) — props `isPausing?`, `isLeaving`, `onPause?`, `onLeave`; pause button plus confirmed "Abbandona" alert dialog [GameActions.tsx:GameActions]
- `PausedPracticeDialog` (default export) — props `open`, `confirmAbandon`, `isLeaving`, `isResuming`, `onCancelAbandon`, `onConfirmAbandon`, `onRequestAbandon`, `onResume` [PausedPracticeDialog.tsx:PausedPracticeDialog]
- `SignalCallout` (default export) — props `signal`, `position`, `username` [SignalCallout.tsx:SignalCallout]
- `RotateDevicePrompt` (default export) — no props [RotateDevicePrompt.tsx:RotateDevicePrompt]

## Invariants
- A hand card is clickable only when it is the local user's turn and the card matches an entry in `playableCards` (suit + value) [GameBoard.tsx:GameBoard]
- The countdown is hidden while a completed trick is shown or while the deal is presenting (`deal.phase !== "ready"`); it turns destructive at `<= 10` seconds [GameBoard.tsx:GameBoard]
- Trick collection is skipped (with `console.warn`) when `completedTrick.winnerUserId` is `null`; all Web Animations are skipped under reduced motion and cancelled on unmount or reduced-motion change [GameBoard.tsx:GameBoard]
- Collection timing: delay 1800 ms / duration 650 ms, or 500 ms / 350 ms when `fastCollection`; each card adds a stagger of `index * 40` ms (`index * 30` ms when `fastCollection`) [GameBoard.tsx:GameBoard]
- When `animatedCard` changes, the played card travels into its table slot over 420 ms, starting from the clicked hand-card rect (local user) or the player's seat rect; skipped under reduced motion [GameBoard.tsx:GameBoard]
- `CardDeal` renders only while `deal.phase === "dealing"` and is keyed by `hand[0]?.roundId`; while the hand is presenting (`deal.phase !== "ready"`), hand cards at index `>= deal.dealtCards` are `invisible` [GameBoard.tsx:GameBoard]
- The table centre holds a polite live region (`role="status" aria-live="polite"`) with a status line ("Presa a …", "Raccolta delle carte...", "Distribuzione delle carte...", "Guarda le tue carte", briscola choice, "Il bot gioca al tuo posto", "Tocca a te" / "Tocca a …") and a line joining the declared signal and `notice` [GameBoard.tsx:GameBoard]
- `CardDeal` renders 40 dealt cards and offsets their delays by time already elapsed since `deal.startedAt`, so a remount does not restart the deal [GameBoard.tsx:CardDeal]
- `GameScoreHeader` shows own/opponent points via `pointsForPlayerTeam` and displays the enum `denara` as "denari" [GameScoreHeader.tsx:GameScoreHeader]
- `GameActions` shows the pause button only when `onPause` is provided; the abandon text and `data-testid` differ for practice (`onPause` set) vs multiplayer [GameActions.tsx:GameActions]
- `PausedPracticeDialog` cannot be dismissed: `onOpenChange` is a no-op and Escape is prevented [PausedPracticeDialog.tsx:PausedPracticeDialog]
- `RotateDevicePrompt` is open exactly when `(pointer: coarse) and (orientation: portrait)` matches; Escape and outside clicks are prevented [RotateDevicePrompt.tsx:PORTRAIT_TOUCH], [RotateDevicePrompt.tsx:RotateDevicePrompt]
- `SignalCallout` hides itself after 2800 ms [SignalCallout.tsx:SignalCallout]

## Side Effects
- DOM measurement (`getBoundingClientRect`) and Web Animations API calls on board elements [GameBoard.tsx:GameBoard]
- `console.warn` when a completed trick has no winner [GameBoard.tsx:GameBoard]
- `window.matchMedia` subscription via `useSyncExternalStore` [RotateDevicePrompt.tsx:subscribe]
- Fullscreen request and landscape orientation lock through `enterGameFullscreen()` from `src/lib/fullscreen.ts`; the "Apri a schermo intero" button renders only when `canEnterGameFullscreen()` is true [RotateDevicePrompt.tsx:RotateDevicePrompt]
- `GameBoard` subscribes to a `prefers-reduced-motion` `matchMedia` listener through `useReducedMotion` [GameBoard.tsx:GameBoard]
- `window.setTimeout` / `clearTimeout` for callout visibility [SignalCallout.tsx:SignalCallout]

## Verification
- Run: `cd frontend && npx vitest run src/__tests__/components/SignalCallout.test.tsx src/__tests__/pages/GameTable.test.tsx`
- Run: `cd frontend && npm run typecheck && npm run lint`
