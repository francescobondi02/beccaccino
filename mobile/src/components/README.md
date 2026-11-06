# UI components (`src/components`)

## Overview
Reusable React Native components for the BECCA visual language (flat offset
shadows, arcade palette) and the shared card table. The live table
(`LiveTable`) and the offline tutorial both use `TableFelt`, `TableCard`,
`PlayerBadge` and `TrumpBadge`. Components receive data through props; none
of them calls the backend.

## Interface
- `ActionButton` `[ActionButton.tsx:ActionButton]`: primary/secondary/selected/disabled button with optional `compact`, `glyph`, `bolt` and `hero` variants; plays tap haptics and sound before `onPress`.
- `CardZoom` `[CardZoom.tsx:CardZoom]`: large preview of a long-pressed card with an optional note; takes a `reduced` prop instead of calling `useReducedMotion`.
- `FitScreen` `[FitScreen.tsx:FitScreen]`: scales content down when it is taller than its box instead of scrolling.
- `GameDialog` `[GameDialog.tsx:GameDialog]`: native `Modal` around `Sheet`; `onClose` enables close X, tap outside and Android back.
- `HomeCardFan` `[HomeCardFan.tsx:HomeCardFan]`: decorative five-card fan with floating and press-tilt animation.
- `Hud.tsx` exports `ScoreBoard`, `TrumpBadge`, `PlayerBadge`, `TimerBadge`, `CenterToast`, `LastTrickButton`, `TrickReview` `[Hud.tsx:ScoreBoard]`, `[Hud.tsx:TrumpBadge]`, `[Hud.tsx:PlayerBadge]`, `[Hud.tsx:TimerBadge]`, `[Hud.tsx:CenterToast]`, `[Hud.tsx:LastTrickButton]`, `[Hud.tsx:TrickReview]`.
- `LiveTable` `[LiveTable.tsx:LiveTable]`: the full landscape table: felt, scoreboard, trump badge, opponent and partner badges, played cards, hand fan (`HandCard`), controls slot, prompt slot and card zoom. The `hidden` prop hides the whole table from accessibility; a "RILASCIA PER GIOCARE" drop zone shows while a card is dragged.
- `Logo` `[Logo.tsx:Logo]`: BECCA brand tile, wordmark and optional tagline.
- `Offset` `[Offset.tsx:Offset]`: solid offset-shadow wrapper; optional `press` value pushes the face into the shadow.
- `OffsetPressable` `[OffsetPressable.tsx:OffsetPressable]`: pressable tile that sinks into an `Offset` shadow, with tap feedback.
- `Panel` `[Panel.tsx:Panel]`: dialog surface with purple edge and acid offset shadow.
- `ScreenHeader` `[ScreenHeader.tsx:ScreenHeader]`: top bar with a back button (`useCloseOrHome`), title and small logo.
- `Sheet` `[Sheet.tsx:Sheet]`: dimmed full-screen layer with a spring-in `Panel` (`SheetPanel`) and optional close X.
- `SoundToggle` `[SoundToggle.tsx:SoundToggle]`: switch bound to `useSoundEnabled` / `setSoundEnabled`.
- `TableCard` `[TableCard.tsx:TableCard]`: animated table card that travels from `origin`, rests at `layout.cards[index]` and collects toward `destination`.
- `TableFelt` `[TableFelt.tsx:TableFelt]`: decorative oval felt with rail and watermark.

## Invariants
- `LiveTable` hand cards are playable only when they are in the `playable` prop and `disabled` is false; the first tap selects, a second tap or a drag plays; a long press (`delayLongPress={280}`) opens the card zoom `[LiveTable.tsx:HandCard]`.
- `LiveTable` places every player with `relativeSeat` (0 left, 1 partner, 2 right, 3 viewer) and shows scores as `[ours, theirs]` with `ourSide` `[LiveTable.tsx:LiveTable]`.
- When a zoomed card leaves the hand (for example after an auto-play), `LiveTable` clears the zoom `[LiveTable.tsx:LiveTable]`.
- After a trick collection animation finishes, `LiveTable` calls `onCollected` only if the effect is still active `[LiveTable.tsx:LiveTable]`.
- `TableCard` skips its entry animation when a `progress` value is supplied (the caller drives the travel) or while `reduceMotion` is `null` (unknown), and jumps to the end when it is `true` `[TableCard.tsx:TableCard]`.
- `TimerBadge` switches to an urgent style at `seconds <= 10` `[Hud.tsx:TimerBadge]`.
- Components treat an unknown reduced-motion preference as reduced (`useReducedMotion() !== false`) `[GameDialog.tsx:GameDialog]`, `[Sheet.tsx:SheetPanel]`, `[HomeCardFan.tsx:HomeCardFan]`, `[LiveTable.tsx:LiveTable]`.
- `HomeCardFan` animates only while focused and while `AppState` is `active` `[HomeCardFan.tsx:HomeCardFan]`.
- `CenterToast` shows a `sticky` message instead of the queue and calls `onDone` only after a finished, non-sticky animation `[Hud.tsx:CenterToast]`.
- `GameDialog` without `onClose` cannot be dismissed by the user `[GameDialog.tsx:GameDialog]`.

## Side Effects
- Haptics through `touchFeedback` and sound through `playSound` on presses and game events `[ActionButton.tsx:ActionButton]`, `[OffsetPressable.tsx:OffsetPressable]`, `[Sheet.tsx:SheetPanel]`, `[SoundToggle.tsx:SoundToggle]`, `[Hud.tsx:CenterToast]`, `[LiveTable.tsx:LiveTable]`.
- Haptics only (`touchFeedback()`, no sound) on press `[Hud.tsx:LastTrickButton]`.
- Persists the sound preference through `setSoundEnabled` `[SoundToggle.tsx:SoundToggle]`.
- Screen-reader announcements with `AccessibilityInfo.announceForAccessibility` `[Hud.tsx:CenterToast]`, `[LiveTable.tsx:LiveTable]`.
- Subscribes to `AppState` changes `[HomeCardFan.tsx:HomeCardFan]`.
- Navigation (back or `router.replace('/')`) through `useCloseOrHome` `[ScreenHeader.tsx:ScreenHeader]`.

## Verification
- Run: `cd mobile && npx jest src/components src/__tests__`
