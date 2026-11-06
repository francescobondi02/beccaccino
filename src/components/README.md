# Components

## Overview
Shared React components for the live (arcade) interface: authentication dialog
and error states, the app header, card rendering, table pieces, game dialogs,
chat, the final result page, and the expert-annotation scenario container.
Feature-specific views live in the subdirectories below.

## Interface
Subdirectories:
- [annotation](./annotation/README.md) — scenario summary, trick, decision controls, skip/difficulty dialogs.
- [game](./game/README.md) — `GameBoard`, `GameScoreHeader`, `GameActions`, `PausedPracticeDialog`, `SignalCallout`, `RotateDevicePrompt`.
- [lobby](./lobby/README.md) — `ArcadeLobby`, `ArcadeHero`, `ArcadeRules`, `LobbyActions`, `LobbyRoomLists`, `LandingCardArtwork`.
- [rooms](./rooms/README.md) — `WaitingRoomPlayers`.
- [ui](./ui/README.md) — generated shadcn/ui primitives.

Direct components (all default exports unless noted):
- `AnnotationScenario` — props `scenario`, `startedAt`, `isSubmitting`, `errorMessage?`, `onLoadAnotherScenario?`, `onConfirm(action, difficulty, responseTimeMs)`, `onSkip(comment, difficulty, responseTimeMs)` [AnnotationScenario.tsx:AnnotationScenario]
- `AuthDialog` — props `open`, `onOpenChange`; login/register form plus a permanently disabled "Google non disponibile" button [AuthDialog.tsx:AuthDialog]
- `AuthErrorState` — props `onRetry`; "Impossibile verificare la sessione" card [AuthErrorState.tsx:AuthErrorState]
- `ConnectionBanner` — props `{ status: ConnectionStatus }` [ConnectionBanner.tsx:ConnectionBanner]
- `ErrorBoundary` (named export, class component) [ErrorBoundary.tsx:ErrorBoundary]
- `GameChat` — props `roomCode`, `userId`; toggle button plus chat panel [GameChat.tsx:GameChat]
- `GameResult` — props `result: GameFinishedPayload`, `players`, `myTeam`, `onHome`, `isReturningHome` [GameResult.tsx:GameResult]
- `Header` — props `onAuthenticate?`, `onBeforeNavigate?: () => Promise<boolean>`; renders primary navigation "Gioca" (`/`), "Tavoli" (`/?view=rooms`) and "Classifica" (`/leaderboard`), an account menu with `/profile`, `/leaderboard`, `/annotate` and "Esci", and its own `ArcadeRules` dialog behind the "Come si gioca" button [Header.tsx:Header]
- `LastTrickDialog` — props `open`, `onOpenChange`, `lastHand`, `players`, `userId` [LastTrickDialog.tsx:LastTrickDialog]
- `PlayerSeat` — props `player`, `isTurn`, `showRole?`, `countdown?`, `signal?`, `testId?` [PlayerSeat.tsx:PlayerSeat]
- `PlayingCard` — props `suit?`, `value?`, `size?` (`sm` | `md` | `lg`), `onClick?`, `clickable?`, `disabled?`, `className?`, `data-testid?` [PlayingCard.tsx:PlayingCard]
- `RoundEndDialog` — props `open`, `result`, `totalPoints`, `myTeam`, `callerName`, `practiceActions?` [RoundEndDialog.tsx:RoundEndDialog]
- `SignalBadge` — props `{ signal: string }` [SignalBadge.tsx:SignalBadge]
- `SignalDialog` — props `open`, `onOpenChange`, `onSelect(signal | null)` [SignalDialog.tsx:SignalDialog]
- `TableCenter` — props `cards` (with `position`), `winnerUserId?`, `children?` [TableCenter.tsx:TableCenter]
- `TrickHistoryDialog` — props `open`, `onOpenChange`, `title`, `description`, `tricks`, `testId`, `actions?`, `children?`; also exports types `HistoryPlay`, `HistoryTrick` [TrickHistoryDialog.tsx:TrickHistoryDialog], [TrickHistoryDialog.tsx:HistoryTrick]
- `TrumpSuitDialog` — props `open`, `onSelectSuit(suit)`, `myCards`, `practiceActions?` [TrumpSuitDialog.tsx:TrumpSuitDialog]

## Invariants
- `AnnotationScenario` resets all selections and dialogs when `scenario.id` changes [AnnotationScenario.tsx:AnnotationScenario]
- A `play_card` action is confirmable only if a matching `legalActions` entry exists; leaders (`actingSeat === currentTrick.starterSeat`) must pick a signal (including `null`), followers always use `signal: null` [AnnotationScenario.tsx:AnnotationScenario]
- Every answer or skip goes through the difficulty dialog before `onConfirm`/`onSkip`; response time is `max(0, Date.now() - startedAt)`, and an empty trimmed skip comment becomes `null` [AnnotationScenario.tsx:AnnotationScenario]
- `AuthDialog` rejects an empty username, an empty password, or a password shorter than 6 characters before calling the API [AuthDialog.tsx:AuthDialog]
- `ConnectionBanner` renders nothing when `status === "connected"` [ConnectionBanner.tsx:ConnectionBanner]
- `GameChat` keeps the last 100 messages, trims and ignores empty input, requires `userId` and `roomCode`, and caps input at 200 characters; unread count shows "9+" above 9 [GameChat.tsx:GameChat]
- `GameResult` shows only awards with a positive count and lists every tied player; round details and trick counts appear only when `result.statistics` exists [GameResult.tsx:GameResult]
- `Header` awaits `onBeforeNavigate()` and cancels navigation or logout when it resolves `false`; if logout then fails after `onBeforeNavigate()` resolved `true`, it navigates to `/` [Header.tsx:Header]
- `PlayingCard` maps the DB suit `denara` to the image file name `denari` (`/images/cards/<value>_<suit>.png`) and falls back to a symbol card if the image fails [PlayingCard.tsx:suitFileMap], [PlayingCard.tsx:PlayingCard]
- `PlayingCard` is a `<button>` only when `onClick` is given, and calls it only when `clickable && !disabled` [PlayingCard.tsx:PlayingCard]
- `RoundEndDialog` and `TrumpSuitDialog` cannot be dismissed by Escape or outside clicks; `TrumpSuitDialog` shows only cards with `inHand` [RoundEndDialog.tsx:RoundEndDialog], [TrumpSuitDialog.tsx:TrumpSuitDialog]
- `TrumpSuitDialog` sends the enum suit values `denara`, `coppe`, `spade`, `bastoni` [TrumpSuitDialog.tsx:italianSuits]
- `SignalDialog` is non-modal, ignores outside interaction and Escape, and offers `striscio`, `busso`, `volo` or `null` ("Niente") [SignalDialog.tsx:SignalDialog]
- `PlayerSeat` shows its countdown only on the active turn and turns destructive at `<= 10` seconds [PlayerSeat.tsx:PlayerSeat]

## Side Effects
- REST: `POST /users/login` or `POST /users/register` with `{ username, password }`, then `setUser` from `useAuth` [AuthDialog.tsx:AuthDialog]
- Socket.IO: subscribes to `chat_message` via `subscribeToRoomEvent` and emits `send_chat_message` with `{ roomCode, message }` [GameChat.tsx:GameChat]
- `Header` calls `useAuth().logout()`, navigates with React Router, and may call `enterGameFullscreen()` [Header.tsx:Header]
- `ErrorBoundary` logs with `console.error` and calls `window.location.reload()` from its button [ErrorBoundary.tsx:ErrorBoundary]
- `AuthDialog` logs auth failures with `console.error`; `AuthDialog`, `Header` show `sonner` toasts [AuthDialog.tsx:AuthDialog], [Header.tsx:Header]
- `GameResult` focuses its heading on mount; `GameChat` scrolls to the newest message [GameResult.tsx:GameResult], [GameChat.tsx:GameChat]

## Verification
- Run: `cd frontend && npx vitest run src/__tests__/components`
- Run: `cd frontend && npm run typecheck && npm run lint`
