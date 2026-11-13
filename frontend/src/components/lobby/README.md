# Lobby Components

## Overview
Views for the home/lobby route: the arcade landing hero, the rules dialog, the
lobby frame that hosts room controls, the create/practice/join entry cards, the
room lists, and the decorative SVG card illustrations. All data and actions come
through props.

Consumers:
- `src/pages/LobbyPage.tsx` imports `ArcadeLobby`, `LobbyActions` and `LobbyRoomLists`.
- `src/components/Header.tsx` imports `ArcadeRules`.
- `ArcadeHero` imports `LandingCardArtwork`.
- Development previews: `src/preview/PreviewStudio.tsx` (`ArcadeHero`, `ArcadeRules`),
  `src/preview/PreviewGameTable.tsx` (`ArcadeRules`) and `src/preview/MobilePreview.tsx`
  (`ArcadeRules`, `LandingCardArtwork`).

`ArcadeLobby` reads reduced motion from `@/hooks/useReducedMotion`.

## Interface
- `ArcadeLobby` (default export) — props `{ children, onPlay }`; renders a skip link to `#main-content`, the hero, a "Trova il tuo socio" section containing `children`, a bottom "FAMMI GIOCARE" button that also calls `onPlay`, a footer link to `/leaderboard`, and `ArcadeRules` [ArcadeLobby.tsx:ArcadeLobby]
- `ArcadeHero` (default export) — props `onPlay`, `onRules`, `motionStopped` [ArcadeHero.tsx:ArcadeHero]
- `ArcadeRules` (default export) — props `open`, `onOpenChange`; Radix dialog with three rule tips [ArcadeRules.tsx:ArcadeRules]
- `LobbyActions` (default export) — props `roomCode`, `onRoomCodeChange`, `onCreateRoom`, `onPractice`, `onJoinByCode`, `disabled?` [LobbyActions.tsx:LobbyActions]
- `LobbyRoomLists` (default export) — props `availableRooms`, `ordinaryActiveGames`, `pausedPracticeGames` (all `LobbyRoom[]` from `src/rooms/lobbyState.ts`), `isConnected`, `isLoading`, `resumingRoomCode`, `onJoin(roomCode)`, `onOpenGame(game: LobbyRoom)`, `onResumePractice(roomCode)`; shows a connection indicator ("Connesso" / "Non connesso" from `isConnected`) and, while `isLoading`, a "Caricamento stanze..." card instead of the lists [LobbyRoomLists.tsx:LobbyRoomLists]
- `LandingCardArtwork` (default export) — props `card` (`"asso_denari" | "tre_spade" | "re_coppe" | "cavallo_bastoni" | "due_denari"`), `className?`; inline SVG illustration [LandingCardArtwork.tsx:LandingCardArtwork], [LandingCardArtwork.tsx:LandingCard]

## Invariants
- `ArcadeLobby` reads `?view=rooms` to set `data-view="rooms"`, otherwise `"play"` [ArcadeLobby.tsx:ArcadeLobby]
- Reduced motion (`useReducedMotion` from `src/hooks/`) forces `MotionConfig reducedMotion="always"` and is passed to `ArcadeHero` as `motionStopped` [ArcadeLobby.tsx:ArcadeLobby]
- With `motionStopped`, hero tilt and entrance offsets are disabled; tilt reacts only to `pointerType === "mouse"` [ArcadeHero.tsx:ArcadeHero]
- `ArcadeRules` restores focus to the element that was focused when it opened [ArcadeRules.tsx:ArcadeRules]
- The join code input uppercases its value and is limited to 6 characters; form submit calls `preventDefault()`; `disabled` disables the create and join-by-code buttons, not the practice button [LobbyActions.tsx:LobbyActions]
- Section order in `LobbyRoomLists`: paused practice, active games, available rooms; one empty state when all three are empty [LobbyRoomLists.tsx:LobbyRoomLists]
- All "Riprendi" buttons are disabled while any `resumingRoomCode` is set; a full available room shows "Piena" and is disabled; "Rientra" passes the whole active game to `onOpenGame` [LobbyRoomLists.tsx:LobbyRoomLists]
- `LandingCardArtwork` has `role="img"` and an `aria-label` of `"<value> di <suit>"` [LandingCardArtwork.tsx:LandingCardArtwork]

## Side Effects
- `ArcadeRules` reads `document.activeElement` and moves focus on close [ArcadeRules.tsx:ArcadeRules]
- `ArcadeLobby` subscribes to a `prefers-reduced-motion` `matchMedia` listener through `useReducedMotion` [ArcadeLobby.tsx:ArcadeLobby]
- Otherwise none; actions are delegated to callback props.

## Verification
- Run: `cd frontend && npx vitest run src/__tests__/components/LandingCardArtwork.test.tsx src/__tests__/pages/LobbyPage.test.tsx`
- Run: `cd frontend && npm run typecheck && npm run lint`
