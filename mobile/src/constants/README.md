# Theme constants (`src/constants`)

## Overview
Shared design tokens for the native app. Most of the palette mirrors the
website's arcade palette (`frontend/src/styles/arcade.css`), so both clients
share one visual identity. `purpleDeep` (`#3b2370`) and `danger` (`#ffb4b4`)
are native-only and do not appear in that file.

## Interface
- `colors` `[theme.ts:colors]`: `background`, `surface`, `text`, `muted`, `primary`, `purple`, `purpleDeep`, `pink`, `ink`, `line`, `danger`.
- `fonts` `[theme.ts:fonts]`: `display`, `label`, `body` text styles (on iOS `label` uses `AvenirNext-Heavy` and `body` uses `Avenir Next`; other platforms use the system font).
- `hard(color, depth = 3)` `[theme.ts:hard]`: flat offset shadow style for small or rotated shapes (iOS only; Android shows none).
- `shared` `[theme.ts:shared]`: `StyleSheet` with `screen`, `layout`, `eyebrow`, `body`, `note`, `error` styles for menu screens.

## Invariants
- None

## Side Effects
- None

## Verification
- Run: `cd mobile && npm run check`
