# Frontend agent notes

Read the root [CLAUDE.md](../CLAUDE.md) and [README.md](./README.md) first.

## Code

- Pages adapt routes and auth, run user commands and compose views. Hooks own
  REST, socket and reconnect coordination. Selectors in `src/game/` and
  `src/rooms/` stay pure. View components get data and callbacks; they never
  fetch or subscribe.
- Every REST read goes through React Query. The table keeps the full
  `GameState` in the `["game", code]` query. Pushes, mutation responses and
  refetches all go through `keepNewer` in `useGameTable` (higher `version` wins).
- Wire types come from `@contract/*`. Do not redefine them.
- Timers show `turn.deadline` corrected by `serverTime`. Deal and summary
  phases use the absolute end times in the state. Never copy server timings.
- `useAuth` drops the socket when the signed-in user changes.
- Add shadcn/ui components with the CLI; do not edit `src/components/ui/` by hand.

## UI

- All UI text is Italian.
- Arcade is the only theme (`html[data-ui="arcade"]` in `index.html`).
- Gameplay uses the original card and suit PNGs in `public/images/`. The
  landing hero artwork in `components/lobby/LandingCardArtwork.tsx` is
  decoration only; keep it apart from `PlayingCard`.
- The table shows only the previous completed trick ("Ultima presa"). No full
  trick history or revealed hands, in practice or development either.
- Disconnecting or leaving the page never pauses or abandons a game. Practice
  has "Pausa e torna alla home" and a confirmed "Abbandona". Multiplayer has a
  confirmed abandon; a bot takes the seat and the game still counts.
  "Riprendi controllo" is the only way back after a bot takes over.
- Respect reduced motion: no flying cards, same reading time.
- Card motion follows server state and measured seat positions. Restored cards
  do not replay animations.
