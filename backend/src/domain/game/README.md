# Domain: Game Rules

## Overview

Pure, side-effect-free Beccaccino rules: card vocabulary, legal-card selection,
trick winner, cricca detection, caller and turn-seat resolution, round scoring,
and cumulative game scoring. These functions take plain data and never touch
the database, timers, or sockets, so persistence, runtime, and serialization
layers can share one rule implementation.

## Interface

- `cards.ts`
  - `Suit`, `Value`: re-exported Prisma enums from `@prisma/client`.
  - `SUITS`, `VALUES`: all enum values.
  - `CARD_SIGNALS` (`"striscio" | "busso" | "volo"`) and type `CardSignal`.
  - type `Card` (`{ suit, value }`).
  - Type guards `isSuit`, `isValue`, `isCardSignal`.
- `legalCards.ts`
  - `selectLegalCards(cards, leadSuit)`: cards of the lead suit when the hand
    holds any, otherwise every card (all cards when `leadSuit` is `null`).
  - `isLegalCard(cards, selected, leadSuit)`: identity check against
    `selectLegalCards`.
- `trickWinner.ts`
  - `determineTrickWinner(playedCards, briscolaSuit)`: returns the winning
    `playerId`.
- `detectCricca.ts`
  - `detectCricca(callerCards, briscolaSuit)`: `true` when the cards include
    tre, due, and asso of the briscola suit.
- `turnOrder.ts`
  - `TABLE_SEATS` (`4`), `seatAfter(seat, offset = 1)`.
  - `nextCallerPlayerId(players, previousCallerId)`.
  - `resolveCaller({ roundNumber, firstTrickStarter, quattroDenaraHolder, previousCaller, nextCaller })`.
  - `resolveTurnSeat({ briscolaChosen, callerSeat, hand })`.
- `roundScore.ts`
  - `computeRoundScore(tricks, playerTeams, briscola)`: per-team
    `{ raw, points, figures }`.
  - `settleRound(score, criccaTeam)`: applies the cricca bonus and returns
    `{ team0, team1, winnerTeam }`.
- `gameScore.ts`
  - Types `RoundScoreRow`, `TeamScore`, `CumulativeScore`, `Team` (`0 | 1`).
  - `sumRoundScores(rounds)`, `decideGameWinner(cumulative, winPoints, callerTeam)`,
    `decideScoreWinner(cumulative, callerTeam)`.

## Invariants

- Card strength, high to low: tre, due, asso, re, cavallo, fante, sette, sei,
  cinque, quattro (`trickWinner.ts:cardStrength`).
- If any briscola was played, the highest briscola wins; otherwise the highest
  card of the lead suit (the first played card's suit) wins. An empty trick
  throws `"No cards played"` (`trickWinner.ts:determineTrickWinner`).
- A player must follow the lead suit when holding it
  (`legalCards.ts:selectLegalCards`).
- Raw card points: asso = 3; tre, due, re, cavallo, fante = 1; others = 0. The
  last trick's winner gets +3 raw. Real points are `floor(raw / 3)` and figures
  are `raw % 3` (`roundScore.ts:computeRoundScore`). A trick with a non-null
  `winnerId` uses it instead of recomputing the winner.
- `settleRound` adds a 3 real-point cricca bonus to `criccaTeam`; the round
  winner has more points, then more figures, and an exact tie goes to team 0
  (`roundScore.ts:settleRound`).
- Cumulative totals are summed on raw values (`points * 3 + figures`) and then
  re-split, so per-round figures are never dropped
  (`gameScore.ts:sumRoundScores`).
- `decideGameWinner` returns `null` until a team reaches `winPoints`; if both
  reach it, the higher real total wins and an exact tie goes to `callerTeam`
  (`gameScore.ts:decideGameWinner`, `decideScoreWinner`).
- Seats advance modulo 4 (`turnOrder.ts:seatAfter`). The round 1 caller is the
  quattro di denara holder; later callers come from `nextCaller(previousCaller)`;
  an explicit `firstTrickStarter` always takes precedence
  (`turnOrder.ts:resolveCaller`).
- Before briscola is chosen, or with no current trick, the turn belongs to the
  caller seat; during a trick, to `starterSeat + playedCardCount`; once four
  cards are played, to `winnerSeat` (`turnOrder.ts:resolveTurnSeat`).

## Side Effects

- None. All functions are pure.

## Verification

- Run: `cd backend && npx jest tests/unit/cards.test.ts tests/unit/detectCricca.test.ts tests/unit/gameRules.test.ts tests/unit/gameScore.test.ts tests/unit/roundScore.test.ts tests/unit/trickWinner.test.ts`
- Run: `cd backend && npm run test:unit`
